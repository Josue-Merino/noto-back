/**
 * Modelo de dominio y funciones de mapeo para el material de estudio generado por la IA.
 * La IA (noto-ai-server) responde en snake_case; el backend expone camelCase.
 */

const DEFAULT_TITLE = 'Material de estudio'

/**
 * @param {object | null | undefined} raw - NotesResponse de la IA.
 */
function notesFromAi(raw) {
  if (!raw) return null
  return {
    title: raw.title,
    language: raw.language,
    summary: raw.summary ?? '',
    blocks: (raw.content ?? []).map((block) => ({
      type: block.type,
      text: block.text,
      emoji: block.emoji || null,
    })),
    actionItems: raw.action_items ?? [],
    supportMaterial: raw.support_material ?? [],
    homework: raw.homework ?? [],
  }
}

/**
 * @param {object | null | undefined} raw - FlashcardsResponse de la IA.
 */
function flashcardsFromAi(raw) {
  if (!raw) return null
  return {
    title: raw.title,
    language: raw.language,
    cards: (raw.cards ?? []).map((card) => ({ front: card.front, back: card.back })),
  }
}

/**
 * @param {object | null | undefined} raw - QuizResponse de la IA.
 */
function quizFromAi(raw) {
  if (!raw) return null
  return {
    title: raw.title,
    language: raw.language,
    questions: (raw.questions ?? []).map((q) => ({
      question: q.question,
      options: q.options ?? [],
      correctOptionIndex: q.correct_option_index,
      explanation: q.explanation ?? '',
    })),
  }
}

/**
 * Transforma la respuesta de `POST /study-material/` de la IA al contenido de dominio.
 * Los materiales que no se pidieron quedan en null.
 * @param {object} raw
 * @returns {{ notes: object | null, flashcards: object | null, quiz: object | null }}
 */
export function contentFromAi(raw) {
  return {
    notes: notesFromAi(raw?.notes),
    flashcards: flashcardsFromAi(raw?.flashcards),
    quiz: quizFromAi(raw?.quiz),
  }
}

/**
 * Elige el título: el que detectó la IA (notas → flashcards → cuestionario) o el nombre del archivo.
 * @param {{ notes: object | null, flashcards: object | null, quiz: object | null }} content
 * @param {string | undefined} originalName
 */
export function resolveTitle(content, originalName) {
  const fromAi = content.notes?.title || content.flashcards?.title || content.quiz?.title
  if (fromAi) return fromAi

  const fromFile = originalName?.replace(/\.[^/.]+$/, '').trim()
  return fromFile || DEFAULT_TITLE
}

/** Materiales que sabe generar la IA, en el orden en que se muestran. */
export const MATERIAL_KEYS = Object.freeze(['notes', 'flashcards', 'quiz'])

/** Estados de un trabajo de generación. */
export const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  PREPARING: 'preparing',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
})

/** Estados en los que el trabajo todavía está corriendo. */
export const ACTIVE_STATUSES = Object.freeze([JOB_STATUS.QUEUED, JOB_STATUS.PREPARING, JOB_STATUS.PROCESSING])

/** Contenido vacío: ningún material generado todavía. */
export function emptyContent() {
  return { notes: null, flashcards: null, quiz: null }
}

/**
 * Une el contenido nuevo al existente: lo que trae la IA reemplaza, lo demás se conserva.
 * @param {{ notes: object | null, flashcards: object | null, quiz: object | null }} current
 * @param {{ notes: object | null, flashcards: object | null, quiz: object | null }} incoming
 */
export function mergeContent(current, incoming) {
  const merged = { ...emptyContent(), ...current }
  for (const key of MATERIAL_KEYS) {
    if (incoming?.[key]) merged[key] = incoming[key]
  }
  return merged
}

/**
 * Materiales que ya tiene el contenido.
 * @param {{ notes: object | null, flashcards: object | null, quiz: object | null }} content
 * @returns {string[]}
 */
export function materialsIn(content) {
  return MATERIAL_KEYS.filter((key) => Boolean(content?.[key]))
}

/**
 * Cantidad de elementos de cada material (bloques del apunte, flashcards y preguntas).
 * @param {{ notes: object | null, flashcards: object | null, quiz: object | null } | null} content
 */
export function countsIn(content) {
  return {
    blocks: content?.notes?.blocks?.length ?? 0,
    flashcards: content?.flashcards?.cards?.length ?? 0,
    questions: content?.quiz?.questions?.length ?? 0,
  }
}

/**
 * Tipo de salida que corresponde a los materiales de una nota guardada.
 * @param {string[]} materials
 * @returns {'flashcards' | 'quiz' | 'full'}
 */
export function outputTypeFor(materials) {
  if (materials.length === 1 && materials[0] === 'flashcards') return 'flashcards'
  if (materials.length === 1 && materials[0] === 'quiz') return 'quiz'
  return 'full'
}

/**
 * Representación pública de un trabajo de generación (nunca expone la ruta del archivo en disco).
 * @param {object} job
 * @param {{ audioAvailable: boolean }} [options]
 */
export function toJobDTO(job, { audioAvailable = false, materials, counts } = {}) {
  return {
    id: job.id,
    status: job.status,
    title: job.title,
    outputType: job.outputType,
    materials: materials ?? materialsIn(job.content),
    counts: counts ?? countsIn(job.content),
    pendingMaterials: job.pendingMaterials ?? [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    source: {
      originType: job.source.originType ?? null,
      originalName: job.source.originalName ?? null,
      mimeType: job.source.mimeType ?? null,
      sizeBytes: job.source.sizeBytes ?? null,
      originalSizeBytes: job.source.originalSizeBytes ?? null,
      durationSec: job.source.durationSec ?? null,
    },
    audio: {
      available: audioAvailable,
      mimeType: audioAvailable ? job.audio?.mimeType ?? null : null,
      sizeBytes: audioAvailable ? job.audio?.sizeBytes ?? null : null,
      expiresAt: audioAvailable ? job.audio?.expiresAt ?? null : null,
    },
    content: job.content,
    error: job.error ?? null,
  }
}
