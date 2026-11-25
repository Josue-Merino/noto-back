import { randomUUID } from 'node:crypto'
import {
  assembleContent,
  attemptFromRow,
  gradeAttempt,
  latestReview,
  latestReviewRow,
  materialRows,
  nextReviewState,
  noteSummary,
  reviewStateToRow,
  toName,
} from './study.mappers.js'

// Columnas de una nota con sus materiales embebidos (PostgREST resuelve las relaciones por las FK)
const NOTE_WITH_CONTENT = `
  note_id, user_id, title, created_at, updated_at,
  block ( block_id, type, content, previous_block_id, next_block_id, created_at ),
  mazo ( mazo_id, mazo_name, created_at,
    flashcard ( flashcard_id, orden, frente, reverso,
      flashcard_review ( flashcard_review_id, ease_factor, interval_days, repetitions, next_review_at, last_reviewed_at, created_at ) ) ),
  cuestionario ( cuestionario_id, cuestionario_name, created_at,
    pregunta ( pregunta_id, orden, enunciado, explicacion, opcion ( opcion_id, orden, texto, es_correcta ) ),
    intento ( intento_id, puntaje, total_preguntas, started_at, finished_at ) )
`

// Columnas de una nota con conteos (para listas)
const NOTE_WITH_COUNTS = `
  note_id, title, created_at, updated_at,
  block ( count ),
  mazo ( flashcard ( count ) ),
  cuestionario ( pregunta ( count ) )
`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Suma los `count` de una relación embebida (PostgREST los devuelve como `[{ count }]`). */
const sumCounts = (items) => (items ?? []).reduce((total, item) => total + (item?.count ?? 0), 0)

/**
 * @param {object} row - Fila de `note` con conteos embebidos (`NOTE_WITH_COUNTS`).
 */
function countsFromRow(row) {
  return {
    blocks: sumCounts(row.block),
    flashcards: (row.mazo ?? []).reduce((total, mazo) => total + sumCounts(mazo.flashcard), 0),
    questions: (row.cuestionario ?? []).reduce((total, c) => total + sumCounts(c.pregunta), 0),
  }
}

/**
 * Lanza el error de PostgREST para que el servicio lo registre y lo traduzca.
 * @param {{ error: object | null }} result
 * @param {string} action
 */
function check(result, action) {
  if (result.error) {
    const err = new Error(`Supabase: no se pudo ${action}: ${result.error.message}`)
    err.cause = result.error
    throw err
  }
  return result.data
}

/**
 * Store del material de estudio en las tablas de Supabase:
 * `note` + `block`, `mazo` + `flashcard` + `flashcard_review`, `cuestionario` + `pregunta` + `opcion`
 * + `intento` + `respuesta`.
 *
 * Usa el cliente **admin** (service role), así que filtra siempre por `user_id` en el código:
 * ninguna consulta devuelve ni modifica material de otro usuario.
 */
export class SupabaseStudyMaterialStore {
  /**
   * @param {object} dependencies
   * @param {import('@supabase/supabase-js').SupabaseClient} dependencies.supabaseAdmin
   * @param {() => string} [dependencies.newId]
   * @param {() => Date} [dependencies.now]
   */
  constructor({ supabaseAdmin, newId = randomUUID, now = () => new Date() }) {
    this.db = supabaseAdmin
    this.newId = newId
    this.now = now
  }

  /**
   * Crea la nota (con `note_id` = id del trabajo) si no existe e inserta solo el material nuevo.
   * PostgREST no ofrece transacciones entre peticiones: si algo falla, se borra lo insertado.
   * @param {{ noteId: string, userId: string, title: string, content: object }} input
   */
  async saveGenerated({ noteId, userId, title, content }) {
    const existing = check(
      await this.db.from('note').select('note_id, user_id, title').eq('note_id', noteId).maybeSingle(),
      'leer la nota'
    )
    if (existing && existing.user_id !== userId) throw new Error('La nota pertenece a otro usuario')

    const rows = materialRows(noteId, existing?.title ?? title, content, this.newId)
    const inserted = []
    const insert = async (table, data, key) => {
      if (!data || (Array.isArray(data) && data.length === 0)) return
      check(await this.db.from(table).insert(data), `guardar ${table}`)
      inserted.push({ table, key, ids: (Array.isArray(data) ? data : [data]).map((row) => row[key]) })
    }

    try {
      if (existing) {
        check(
          await this.db.from('note').update({ updated_at: this.now().toISOString() }).eq('note_id', noteId),
          'actualizar la nota'
        )
      } else {
        await insert('note', { note_id: noteId, user_id: userId, title: toName(title, 'Material de estudio') }, 'note_id')
      }
      // Los bloques se enlazan entre sí: van en un solo insert (las FK se revisan al final de la sentencia)
      await insert('block', rows.blocks, 'block_id')
      await insert('mazo', rows.mazo, 'mazo_id')
      await insert('flashcard', rows.flashcards, 'flashcard_id')
      await insert('cuestionario', rows.cuestionario, 'cuestionario_id')
      await insert('pregunta', rows.preguntas, 'pregunta_id')
      await insert('opcion', rows.opciones, 'opcion_id')
    } catch (err) {
      for (const { table, key, ids } of inserted.reverse()) {
        await this.db.from(table).delete().in(key, ids).then(
          () => {},
          () => {}
        )
      }
      throw err
    }
  }

  /**
   * Nota completa del usuario (o null si no existe o es de otro usuario).
   * @param {string} userId
   * @param {string} noteId
   */
  async load(userId, noteId) {
    if (!UUID_RE.test(noteId)) return null
    const note = check(
      await this.db.from('note').select(NOTE_WITH_CONTENT).eq('note_id', noteId).eq('user_id', userId).maybeSingle(),
      'leer la nota'
    )
    if (!note) return null

    const counts = {
      blocks: note.block?.length ?? 0,
      flashcards: (note.mazo ?? []).reduce((total, m) => total + (m.flashcard?.length ?? 0), 0),
      questions: (note.cuestionario ?? []).reduce((total, c) => total + (c.pregunta?.length ?? 0), 0),
    }
    return {
      ...noteSummary(note, counts),
      content: assembleContent({ note, blocks: note.block, mazos: note.mazo, cuestionarios: note.cuestionario }),
    }
  }

  /**
   * @param {string} userId
   * @param {string} noteId
   */
  async summary(userId, noteId) {
    if (!UUID_RE.test(noteId)) return null
    const row = check(
      await this.db.from('note').select(NOTE_WITH_COUNTS).eq('note_id', noteId).eq('user_id', userId).maybeSingle(),
      'leer la nota'
    )
    return row ? noteSummary(row, countsFromRow(row)) : null
  }

  /**
   * Notas del usuario con conteos, de la más reciente a la más antigua.
   * @param {string} userId
   */
  async list(userId) {
    const rows = check(
      await this.db.from('note').select(NOTE_WITH_COUNTS).eq('user_id', userId).order('created_at', { ascending: false }),
      'listar las notas'
    )
    return (rows ?? []).map((row) => noteSummary(row, countsFromRow(row)))
  }

  /**
   * Califica una flashcard con SM-2. Hay una fila de estado por tarjeta: se actualiza o se crea.
   * @param {string} userId
   * @param {string} flashcardId
   * @param {'again' | 'hard' | 'good' | 'easy'} rating
   * @returns {Promise<{ flashcardId: string, review: object } | null>} null si la tarjeta no es del usuario.
   */
  async reviewFlashcard(userId, flashcardId, rating) {
    if (!UUID_RE.test(flashcardId)) return null
    const card = check(
      await this.db
        .from('flashcard')
        .select('flashcard_id, mazo!inner ( note!inner ( user_id ) ), flashcard_review ( flashcard_review_id, ease_factor, interval_days, repetitions, next_review_at, last_reviewed_at, created_at )')
        .eq('flashcard_id', flashcardId)
        .eq('mazo.note.user_id', userId)
        .maybeSingle(),
      'leer la flashcard'
    )
    if (!card) return null

    const review = nextReviewState(latestReview(card.flashcard_review), rating, this.now())
    const current = latestReviewRow(card.flashcard_review)

    if (current) {
      check(
        await this.db
          .from('flashcard_review')
          .update(reviewStateToRow(review))
          .eq('flashcard_review_id', current.flashcard_review_id),
        'guardar el repaso'
      )
    } else {
      check(
        await this.db.from('flashcard_review').insert({ flashcard_id: flashcardId, ...reviewStateToRow(review) }),
        'guardar el repaso'
      )
    }
    return { flashcardId, review }
  }

  /**
   * Guarda un intento del cuestionario calificado en el servidor.
   * @param {string} userId
   * @param {string} quizId
   * @param {{ startedAt?: string, answers: Array<{ questionId: string, optionId: string | null }> }} input
   * @returns {Promise<object | null>} null si el cuestionario no es del usuario.
   */
  async saveAttempt(userId, quizId, { startedAt, answers }) {
    if (!UUID_RE.test(quizId)) return null
    const quiz = check(
      await this.db
        .from('cuestionario')
        .select('cuestionario_id, note!inner ( user_id ), pregunta ( pregunta_id, opcion ( opcion_id, es_correcta ) )')
        .eq('cuestionario_id', quizId)
        .eq('note.user_id', userId)
        .maybeSingle(),
      'leer el cuestionario'
    )
    if (!quiz) return null

    const intentoId = this.newId()
    const graded = gradeAttempt(quiz.pregunta ?? [], answers, intentoId)
    const finishedAt = this.now().toISOString()
    const intento = {
      intento_id: intentoId,
      cuestionario_id: quizId,
      puntaje: graded.score,
      total_preguntas: graded.total,
      started_at: startedAt ?? finishedAt,
      finished_at: finishedAt,
    }

    check(await this.db.from('intento').insert(intento), 'guardar el intento')
    if (graded.respuestas.length) {
      const result = await this.db.from('respuesta').insert(graded.respuestas)
      if (result.error) {
        await this.db.from('intento').delete().eq('intento_id', intentoId).then(
          () => {},
          () => {}
        )
        check(result, 'guardar las respuestas')
      }
    }
    return { ...attemptFromRow(intento), correctCount: graded.correctCount }
  }
}
