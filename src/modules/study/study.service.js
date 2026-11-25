import { NotFoundError } from '../../errors/httpErrors.js'

/**
 * Repaso del material guardado: calificar flashcards (SM-2) y guardar intentos del cuestionario.
 * La lógica de las tablas vive en el store; aquí se traducen los "no encontrado" a errores HTTP.
 */
export class StudyService {
  /**
   * @param {object} dependencies
   * @param {import('./study.store.supabase.js').SupabaseStudyMaterialStore} dependencies.studyStore
   * @param {import('pino').Logger} [dependencies.logger]
   */
  constructor({ studyStore, logger }) {
    this.studyStore = studyStore
    this.logger = logger
  }

  /**
   * @param {string} userId
   * @param {string} flashcardId
   * @param {'again' | 'hard' | 'good' | 'easy'} rating
   */
  async reviewFlashcard(userId, flashcardId, rating) {
    const result = await this.studyStore.reviewFlashcard(userId, flashcardId, rating)
    if (!result) throw new NotFoundError('No encontramos esta flashcard.', 'FLASHCARD_NOT_FOUND')
    return result
  }

  /**
   * @param {string} userId
   * @param {string} quizId
   * @param {{ startedAt?: string, answers: Array<{ questionId: string, optionId: string | null }> }} attempt
   */
  async saveAttempt(userId, quizId, attempt) {
    const result = await this.studyStore.saveAttempt(userId, quizId, attempt)
    if (!result) throw new NotFoundError('No encontramos este cuestionario.', 'QUIZ_NOT_FOUND')
    this.logger?.info({ userId, quizId, score: result.score }, 'Intento de cuestionario guardado')
    return result
  }
}
