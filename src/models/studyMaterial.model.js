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

/**
 * Representación pública del material de estudio.
 * @param {object} material
 */
export function toPublicDTO(material) {
  return {
    id: material.id,
    title: material.title,
    outputType: material.outputType,
    createdAt: material.createdAt,
    source: {
      originType: material.source.originType ?? null,
      originalName: material.source.originalName ?? null,
      mimeType: material.source.mimeType ?? null,
      sizeBytes: material.source.sizeBytes ?? null,
      originalSizeBytes: material.source.originalSizeBytes ?? null,
      durationSec: material.source.durationSec ?? null,
    },
    content: material.content,
  }
}
