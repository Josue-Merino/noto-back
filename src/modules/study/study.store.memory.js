import { randomUUID } from 'node:crypto'
import {
  assembleContent,
  gradeAttempt,
  latestReview,
  materialRows,
  nextReviewState,
  noteSummary,
  reviewStateToRow,
  attemptFromRow,
  toName,
} from './study.mappers.js'

/**
 * Store de material de estudio **en memoria** con la misma interfaz que `SupabaseStudyMaterialStore`.
 * Imita las tablas de Supabase (mismas filas y columnas) para que las pruebas y el back de demo
 * pasen por los mismos mapeos que la base de datos real.
 */
export class InMemoryStudyMaterialStore {
  constructor({ newId = randomUUID, now = () => new Date() } = {}) {
    this.newId = newId
    this.now = now
    this.tables = {
      note: [],
      block: [],
      mazo: [],
      flashcard: [],
      flashcard_review: [],
      cuestionario: [],
      pregunta: [],
      opcion: [],
      intento: [],
      respuesta: [],
    }
  }

  /**
   * Crea la nota si no existe e inserta solo el material nuevo.
   * @param {{ noteId: string, userId: string, title: string, content: object }} input
   */
  async saveGenerated({ noteId, userId, title, content }) {
    const stamp = this.now().toISOString()
    const existing = this.tables.note.find((n) => n.note_id === noteId)
    if (existing && existing.user_id !== userId) throw new Error('La nota pertenece a otro usuario')

    const rows = materialRows(noteId, existing?.title ?? title, content, this.newId)
    const withDate = (row) => ({ ...row, created_at: stamp })

    if (existing) existing.updated_at = stamp
    else {
      this.tables.note.push({
        note_id: noteId,
        user_id: userId,
        folder_id: null,
        title: toName(title, 'Material de estudio'),
        transcript: null,
        created_at: stamp,
        updated_at: stamp,
      })
    }

    this.tables.block.push(...rows.blocks.map((row) => ({ ...withDate(row), updated_at: stamp })))
    if (rows.mazo) this.tables.mazo.push(withDate(rows.mazo))
    this.tables.flashcard.push(...rows.flashcards.map(withDate))
    if (rows.cuestionario) this.tables.cuestionario.push(withDate(rows.cuestionario))
    this.tables.pregunta.push(...rows.preguntas.map(withDate))
    this.tables.opcion.push(...rows.opciones)
  }

  /**
   * @param {string} userId
   * @param {string} noteId
   */
  async load(userId, noteId) {
    const note = this.#ownedNote(userId, noteId)
    if (!note) return null

    const t = this.tables
    const mazos = t.mazo
      .filter((m) => m.note_id === noteId)
      .map((m) => ({
        ...m,
        flashcard: t.flashcard
          .filter((f) => f.mazo_id === m.mazo_id)
          .map((f) => ({ ...f, flashcard_review: t.flashcard_review.filter((r) => r.flashcard_id === f.flashcard_id) })),
      }))
    const cuestionarios = t.cuestionario
      .filter((c) => c.note_id === noteId)
      .map((c) => ({
        ...c,
        pregunta: t.pregunta
          .filter((p) => p.cuestionario_id === c.cuestionario_id)
          .map((p) => ({ ...p, opcion: t.opcion.filter((o) => o.pregunta_id === p.pregunta_id) })),
        intento: t.intento.filter((i) => i.cuestionario_id === c.cuestionario_id),
      }))

    return {
      ...noteSummary(note, this.#counts(noteId)),
      content: assembleContent({ note, blocks: t.block.filter((b) => b.note_id === noteId), mazos, cuestionarios }),
    }
  }

  /**
   * @param {string} userId
   * @param {string} noteId
   */
  async summary(userId, noteId) {
    const note = this.#ownedNote(userId, noteId)
    return note ? noteSummary(note, this.#counts(noteId)) : null
  }

  /**
   * Notas del usuario, de la más reciente a la más antigua.
   * @param {string} userId
   */
  async list(userId) {
    return this.tables.note
      .filter((n) => n.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((note) => noteSummary(note, this.#counts(note.note_id)))
  }

  /**
   * @param {string} userId
   * @param {string} flashcardId
   * @param {'again' | 'hard' | 'good' | 'easy'} rating
   * @returns {Promise<{ flashcardId: string, review: object } | null>} null si la tarjeta no es del usuario.
   */
  async reviewFlashcard(userId, flashcardId, rating) {
    const card = this.tables.flashcard.find((f) => f.flashcard_id === flashcardId)
    const mazo = card && this.tables.mazo.find((m) => m.mazo_id === card.mazo_id)
    if (!mazo || !this.#ownedNote(userId, mazo.note_id)) return null

    const rows = this.tables.flashcard_review.filter((r) => r.flashcard_id === flashcardId)
    const review = nextReviewState(latestReview(rows), rating, this.now())
    const current = rows.at(-1)
    if (current) Object.assign(current, reviewStateToRow(review))
    else {
      this.tables.flashcard_review.push({
        flashcard_review_id: this.newId(),
        flashcard_id: flashcardId,
        ...reviewStateToRow(review),
        created_at: this.now().toISOString(),
      })
    }
    return { flashcardId, review }
  }

  /**
   * @param {string} userId
   * @param {string} quizId
   * @param {{ startedAt?: string, answers: Array<{ questionId: string, optionId: string | null }> }} input
   * @returns {Promise<object | null>} null si el cuestionario no es del usuario.
   */
  async saveAttempt(userId, quizId, { startedAt, answers }) {
    const cuestionario = this.tables.cuestionario.find((c) => c.cuestionario_id === quizId)
    if (!cuestionario || !this.#ownedNote(userId, cuestionario.note_id)) return null

    const preguntas = this.tables.pregunta
      .filter((p) => p.cuestionario_id === quizId)
      .map((p) => ({ ...p, opcion: this.tables.opcion.filter((o) => o.pregunta_id === p.pregunta_id) }))
    const intentoId = this.newId()
    const graded = gradeAttempt(preguntas, answers, intentoId)
    const finishedAt = this.now().toISOString()
    const intento = {
      intento_id: intentoId,
      cuestionario_id: quizId,
      puntaje: graded.score,
      total_preguntas: graded.total,
      started_at: startedAt ?? finishedAt,
      finished_at: finishedAt,
    }
    this.tables.intento.push(intento)
    this.tables.respuesta.push(...graded.respuestas.map((r) => ({ respuesta_id: this.newId(), ...r })))
    return { ...attemptFromRow(intento), correctCount: graded.correctCount }
  }

  #ownedNote(userId, noteId) {
    const note = this.tables.note.find((n) => n.note_id === noteId)
    return note && note.user_id === userId ? note : null
  }

  #counts(noteId) {
    const t = this.tables
    const mazoIds = new Set(t.mazo.filter((m) => m.note_id === noteId).map((m) => m.mazo_id))
    const quizIds = new Set(t.cuestionario.filter((c) => c.note_id === noteId).map((c) => c.cuestionario_id))
    return {
      blocks: t.block.filter((b) => b.note_id === noteId).length,
      flashcards: t.flashcard.filter((f) => mazoIds.has(f.mazo_id)).length,
      questions: t.pregunta.filter((p) => quizIds.has(p.cuestionario_id)).length,
    }
  }
}
