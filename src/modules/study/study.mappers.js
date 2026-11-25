/**
 * Conversión entre el material de estudio del dominio (camelCase, como lo expone la API) y las
 * filas de las tablas de Supabase: `note` + `block`, `mazo` + `flashcard` (+ `flashcard_review`),
 * `cuestionario` + `pregunta` + `opcion` (+ `intento` + `respuesta`).
 *
 * Funciones puras: las usan el store de Supabase y el de memoria, así ambos guardan y leen igual.
 */

/** Valores del enum `block_type` de la base de datos (los mismos que genera la IA). */
export const BLOCK_TYPES = Object.freeze([
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'paragraph',
  'quote',
  'callout',
  'bullet_list_item',
  'numbered_list_item',
  'table',
  'code',
  'todo_list_item',
])

/**
 * Encabezados de sección del apunte. Es el mismo formato que escribe el datasource de la IA
 * (noto-ai-server/app/features/notes/data/datasource/supabase_note_persistence_datasource.py).
 */
const SECTIONS = Object.freeze([
  { key: 'summary', es: 'Resumen', en: 'Summary' },
  { key: 'content', es: 'Contenido', en: 'Content' },
  { key: 'actionItems', es: 'Items de Acción', en: 'Action Items' },
  { key: 'supportMaterial', es: 'Material de Apoyo', en: 'Support Material' },
  { key: 'homework', es: 'Tarea', en: 'Homework' },
])

const LIST_SECTIONS = ['actionItems', 'supportMaterial', 'homework']

/** Límite prudente para columnas `varchar` (títulos y nombres). */
const MAX_NAME_LENGTH = 255

// Emoji al inicio del texto (con variantes, tonos de piel y secuencias ZWJ) seguido de un espacio
const LEADING_EMOJI_RE =
  /^(\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*)\s+([\s\S]*)$/u

/**
 * @param {string | null | undefined} value
 * @param {string} fallback
 */
export const toName = (value, fallback) => (value?.trim() || fallback).slice(0, MAX_NAME_LENGTH)

const DAY_MS = 24 * 60 * 60 * 1000

// ===== Apunte: note + block =====

/**
 * Bloques en orden de lectura (sin ids) a partir de las notas del dominio.
 * @param {{ language?: string, summary?: string, blocks?: Array<{ type: string, text: string, emoji?: string | null }>,
 *   actionItems?: string[], supportMaterial?: string[], homework?: string[] }} notes
 * @returns {Array<{ type: string, content: string }>}
 */
export function notesToBlocks(notes) {
  const lang = notes.language === 'en' ? 'en' : 'es'
  const heading = (key) => ({ type: 'heading1', content: SECTIONS.find((s) => s.key === key)[lang] })
  const blocks = []

  if (notes.summary?.trim()) {
    blocks.push(heading('summary'), { type: 'paragraph', content: notes.summary })
  }

  if (notes.blocks?.length) {
    blocks.push(heading('content'))
    for (const block of notes.blocks) {
      const type = BLOCK_TYPES.includes(block.type) ? block.type : 'paragraph'
      blocks.push({ type, content: block.emoji ? `${block.emoji} ${block.text}` : block.text })
    }
  }

  for (const key of LIST_SECTIONS) {
    const items = notes[key] ?? []
    if (items.length) {
      blocks.push(heading(key))
      for (const item of items) blocks.push({ type: 'bullet_list_item', content: item })
    }
  }

  return blocks
}

/**
 * Filas de `block` enlazadas entre sí (anterior/siguiente), listas para un solo insert.
 * @param {string} noteId
 * @param {Array<{ type: string, content: string }>} blocks
 * @param {() => string} newId
 */
export function blocksToRows(noteId, blocks, newId) {
  const ids = blocks.map(() => newId())
  return blocks.map((block, i) => ({
    block_id: ids[i],
    note_id: noteId,
    type: block.type,
    content: block.content,
    previous_block_id: i > 0 ? ids[i - 1] : null,
    next_block_id: i < blocks.length - 1 ? ids[i + 1] : null,
  }))
}

/**
 * Ordena las filas de `block` siguiendo la lista enlazada. Si la cadena está rota (o hay varias),
 * se ordena por fecha de creación conservando el orden recibido en los empates.
 * @param {Array<{ block_id: string, previous_block_id: string | null, next_block_id: string | null, created_at?: string }>} rows
 */
export function orderBlocks(rows) {
  if (rows.length === 0) return []
  const byId = new Map(rows.map((row) => [row.block_id, row]))
  const heads = rows.filter((row) => !row.previous_block_id || !byId.has(row.previous_block_id))

  if (heads.length === 1) {
    const ordered = []
    const seen = new Set()
    for (let row = heads[0]; row && !seen.has(row.block_id); row = byId.get(row.next_block_id)) {
      seen.add(row.block_id)
      ordered.push(row)
    }
    if (ordered.length === rows.length) return ordered
  }

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.created_at ?? '').localeCompare(b.row.created_at ?? '') || a.index - b.index)
    .map(({ row }) => row)
}

/**
 * @param {string} text
 * @returns {{ text: string, emoji: string | null }}
 */
function splitEmoji(text) {
  const match = text.match(LEADING_EMOJI_RE)
  return match ? { emoji: match[1], text: match[2] } : { emoji: null, text }
}

/**
 * Notas del dominio a partir de los bloques ya ordenados (inverso de `notesToBlocks`).
 * @param {string} title
 * @param {Array<{ type: string, content: string | null }>} blocks
 * @returns {object | null} null si la nota no tiene bloques.
 */
export function blocksToNotes(title, blocks) {
  if (blocks.length === 0) return null

  const notes = { title, language: 'es', summary: '', blocks: [], actionItems: [], supportMaterial: [], homework: [] }
  const summary = []
  let section = 'content'

  for (const block of blocks) {
    const content = block.content ?? ''
    if (block.type === 'heading1') {
      const marker = SECTIONS.find((s) => s.es === content.trim() || s.en === content.trim())
      if (marker) {
        section = marker.key
        if (content.trim() === marker.en && marker.es !== marker.en) notes.language = 'en'
        continue
      }
    }

    if (section === 'summary') summary.push(content)
    else if (section === 'content') notes.blocks.push({ type: block.type, ...splitEmoji(content) })
    else notes[section].push(content)
  }

  notes.summary = summary.join('\n\n')
  return notes
}

// ===== Flashcards: mazo + flashcard + flashcard_review =====

/**
 * @param {string} mazoId
 * @param {Array<{ front: string, back: string }>} cards
 * @param {() => string} newId
 */
export function flashcardsToRows(mazoId, cards, newId) {
  return cards.map((card, i) => ({
    flashcard_id: newId(),
    mazo_id: mazoId,
    orden: i,
    frente: card.front,
    reverso: card.back,
  }))
}

/**
 * Normaliza un embebido de PostgREST: llega como objeto (o null) cuando la llave foránea tiene
 * una restricción única, como `flashcard_review.flashcard_id` en el proyecto de Noto, y como
 * arreglo si no la tiene.
 * @param {Array<object> | object | null | undefined} value
 * @returns {Array<object>}
 */
export const asArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value])

/**
 * Fila de `flashcard_review` más reciente de una tarjeta (o null si nunca se repasó).
 * @param {Array<object> | object | null | undefined} reviews - Embebido `flashcard_review`.
 */
export function latestReviewRow(reviews) {
  const rows = asArray(reviews)
  if (!rows.length) return null
  return [...rows].sort((a, b) =>
    (b.last_reviewed_at ?? b.created_at ?? '').localeCompare(a.last_reviewed_at ?? a.created_at ?? '')
  )[0]
}

/**
 * Estado de repaso más reciente de una tarjeta (o null si nunca se repasó).
 * @param {Array<object> | object | null | undefined} reviews - Embebido `flashcard_review`.
 */
export function latestReview(reviews) {
  const row = latestReviewRow(reviews)
  if (!row) return null
  return {
    easeFactor: Number(row.ease_factor),
    intervalDays: Number(row.interval_days),
    repetitions: Number(row.repetitions),
    nextReviewAt: row.next_review_at ?? null,
    lastReviewedAt: row.last_reviewed_at ?? null,
  }
}

/**
 * @param {{ mazo_name: string }} mazo
 * @param {Array<object>} flashcardRows - Con `flashcard_review` embebido (opcional).
 * @param {string} language
 */
export function rowsToFlashcards(mazo, flashcardRows, language) {
  return {
    id: mazo.mazo_id,
    title: mazo.mazo_name,
    language,
    cards: [...flashcardRows]
      .sort((a, b) => a.orden - b.orden)
      .map((row) => ({
        id: row.flashcard_id,
        front: row.frente,
        back: row.reverso,
        review: latestReview(row.flashcard_review),
      })),
  }
}

/** Calificaciones del repaso y su calidad en la escala SM-2 (0-5). */
export const RATING_QUALITY = Object.freeze({ again: 1, hard: 3, good: 4, easy: 5 })

/**
 * Algoritmo SM-2: nuevo estado de una tarjeta después de calificarla.
 * "Otra vez" la deja pendiente de inmediato (intervalo 0) y reinicia las repeticiones.
 * @param {{ easeFactor: number, intervalDays: number, repetitions: number } | null} previous
 * @param {'again' | 'hard' | 'good' | 'easy'} rating
 * @param {Date} now
 */
export function nextReviewState(previous, rating, now) {
  const quality = RATING_QUALITY[rating]
  let easeFactor = previous?.easeFactor ?? 2.5
  let repetitions = previous?.repetitions ?? 0
  let intervalDays = previous?.intervalDays ?? 0

  if (quality < 3) {
    repetitions = 0
    intervalDays = 0
  } else {
    repetitions += 1
    if (repetitions === 1) intervalDays = 1
    else if (repetitions === 2) intervalDays = 6
    else intervalDays = Math.max(1, Math.round(intervalDays * easeFactor))
  }

  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))

  return {
    easeFactor: Math.round(easeFactor * 100) / 100,
    intervalDays,
    repetitions,
    nextReviewAt: new Date(now.getTime() + intervalDays * DAY_MS).toISOString(),
    lastReviewedAt: now.toISOString(),
  }
}

/**
 * @param {ReturnType<typeof nextReviewState>} state
 */
export const reviewStateToRow = (state) => ({
  ease_factor: state.easeFactor,
  interval_days: state.intervalDays,
  repetitions: state.repetitions,
  next_review_at: state.nextReviewAt,
  last_reviewed_at: state.lastReviewedAt,
})

// ===== Cuestionario: cuestionario + pregunta + opcion (+ intento + respuesta) =====

/**
 * @param {string} cuestionarioId
 * @param {Array<{ question: string, options: string[], correctOptionIndex: number, explanation?: string }>} questions
 * @param {() => string} newId
 */
export function quizToRows(cuestionarioId, questions, newId) {
  const preguntas = []
  const opciones = []
  questions.forEach((question, i) => {
    const preguntaId = newId()
    preguntas.push({
      pregunta_id: preguntaId,
      cuestionario_id: cuestionarioId,
      orden: i,
      enunciado: question.question,
      explicacion: question.explanation || null,
    })
    question.options.forEach((texto, j) => {
      opciones.push({
        opcion_id: newId(),
        pregunta_id: preguntaId,
        orden: j,
        texto,
        es_correcta: j === question.correctOptionIndex,
      })
    })
  })
  return { preguntas, opciones }
}

/**
 * @param {{ intento_id: string, puntaje: number | null, total_preguntas: number, started_at: string, finished_at: string | null }} row
 */
export function attemptFromRow(row) {
  const score = row.puntaje === null || row.puntaje === undefined ? null : Number(row.puntaje)
  return {
    id: row.intento_id,
    score,
    total: row.total_preguntas,
    correctCount: score === null ? null : Math.round((score / 100) * row.total_preguntas),
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
  }
}

/**
 * @param {{ cuestionario_id: string, cuestionario_name: string }} cuestionario
 * @param {Array<object>} preguntaRows - Con `opcion` embebido.
 * @param {Array<object>} intentoRows
 * @param {string} language
 */
export function rowsToQuiz(cuestionario, preguntaRows, intentoRows, language) {
  const attempts = [...(intentoRows ?? [])]
    .filter((row) => row.finished_at)
    .sort((a, b) => b.finished_at.localeCompare(a.finished_at))
    .map(attemptFromRow)

  return {
    id: cuestionario.cuestionario_id,
    title: cuestionario.cuestionario_name,
    language,
    questions: [...preguntaRows]
      .sort((a, b) => a.orden - b.orden)
      .map((row) => {
        const options = [...(row.opcion ?? [])].sort((a, b) => a.orden - b.orden)
        return {
          id: row.pregunta_id,
          question: row.enunciado,
          options: options.map((o) => o.texto),
          optionIds: options.map((o) => o.opcion_id),
          correctOptionIndex: options.findIndex((o) => o.es_correcta),
          explanation: row.explicacion ?? '',
        }
      }),
    attempts: attempts.slice(0, 5),
    bestScore: attempts.length ? Math.max(...attempts.map((a) => a.score ?? 0)) : null,
  }
}

/**
 * Califica un intento en el servidor (no se confía en lo que diga el cliente sobre qué es correcto).
 * @param {Array<{ pregunta_id: string, opcion: Array<{ opcion_id: string, es_correcta: boolean }> }>} preguntaRows
 * @param {Array<{ questionId: string, optionId: string | null }>} answers
 * @param {string} intentoId
 */
export function gradeAttempt(preguntaRows, answers, intentoId) {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a.optionId ?? null]))
  const respuestas = []
  let correctCount = 0

  for (const pregunta of preguntaRows) {
    if (!byQuestion.has(pregunta.pregunta_id)) continue
    const optionId = byQuestion.get(pregunta.pregunta_id)
    const option = (pregunta.opcion ?? []).find((o) => o.opcion_id === optionId)
    const esCorrecta = Boolean(option?.es_correcta)
    if (esCorrecta) correctCount += 1
    respuestas.push({
      intento_id: intentoId,
      pregunta_id: pregunta.pregunta_id,
      opcion_id: option ? optionId : null,
      es_correcta: esCorrecta,
    })
  }

  const total = preguntaRows.length
  const score = total ? Math.round((correctCount / total) * 10000) / 100 : 0
  return { respuestas, correctCount, total, score }
}

// ===== Nota completa =====

/**
 * Todas las filas que hay que insertar para guardar el material **nuevo** de una nota.
 * @param {string} noteId
 * @param {string} title - Título de la nota (respaldo para el nombre del mazo y del cuestionario).
 * @param {{ notes: object | null, flashcards: object | null, quiz: object | null }} content
 * @param {() => string} newId
 */
export function materialRows(noteId, title, content, newId) {
  const rows = { blocks: [], mazo: null, flashcards: [], cuestionario: null, preguntas: [], opciones: [] }

  if (content.notes) rows.blocks = blocksToRows(noteId, notesToBlocks(content.notes), newId)

  if (content.flashcards) {
    rows.mazo = { mazo_id: newId(), note_id: noteId, mazo_name: toName(content.flashcards.title, title) }
    rows.flashcards = flashcardsToRows(rows.mazo.mazo_id, content.flashcards.cards ?? [], newId)
  }

  if (content.quiz) {
    rows.cuestionario = {
      cuestionario_id: newId(),
      note_id: noteId,
      cuestionario_name: toName(content.quiz.title, title),
    }
    Object.assign(rows, quizToRows(rows.cuestionario.cuestionario_id, content.quiz.questions ?? [], newId))
  }

  return rows
}

/**
 * Resumen de una nota para listas (sin cargar el contenido).
 * @param {{ note_id: string, title: string | null, created_at: string, updated_at: string }} note
 * @param {{ blocks: number, flashcards: number, questions: number }} counts
 */
export function noteSummary(note, counts) {
  return {
    noteId: note.note_id,
    title: note.title ?? '',
    createdAt: note.created_at,
    updatedAt: note.updated_at,
    counts,
    materials: materialsFromCounts(counts),
  }
}

/**
 * Materiales que tiene una nota según sus conteos.
 * @param {{ blocks: number, flashcards: number, questions: number }} counts
 */
export function materialsFromCounts(counts) {
  const materials = []
  if (counts.blocks > 0) materials.push('notes')
  if (counts.flashcards > 0) materials.push('flashcards')
  if (counts.questions > 0) materials.push('quiz')
  return materials
}

/**
 * Contenido de dominio de una nota a partir de sus filas (todas las tablas ya filtradas por la nota).
 * Si hay varios mazos o cuestionarios, se usa el primero (la generación crea uno de cada uno).
 * @param {object} rows
 * @param {object} rows.note
 * @param {Array<object>} rows.blocks
 * @param {Array<object>} rows.mazos - Con `flashcard` (y `flashcard_review`) embebidos.
 * @param {Array<object>} rows.cuestionarios - Con `pregunta` (y `opcion`) e `intento` embebidos.
 */
export function assembleContent({ note, blocks, mazos, cuestionarios }) {
  const notes = blocksToNotes(note.title ?? '', orderBlocks(blocks ?? []))
  const language = notes?.language ?? 'es'
  const byDate = (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')
  const mazo = [...(mazos ?? [])].sort(byDate)[0]
  const cuestionario = [...(cuestionarios ?? [])].sort(byDate)[0]

  return {
    notes,
    flashcards: mazo ? rowsToFlashcards(mazo, mazo.flashcard ?? [], language) : null,
    quiz: cuestionario
      ? rowsToQuiz(cuestionario, cuestionario.pregunta ?? [], cuestionario.intento ?? [], language)
      : null,
  }
}
