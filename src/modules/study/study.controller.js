import { asyncHandler } from '../../utils/asyncHandler.js'
import { apiResponse } from '../../utils/apiResponse.js'

/**
 * Controlador HTTP del repaso (flashcards y cuestionarios guardados en Supabase).
 */
export class StudyController {
  /**
   * @param {object} dependencies
   * @param {import('./study.service.js').StudyService} dependencies.studyService
   */
  constructor({ studyService }) {
    this.studyService = studyService
  }

  // POST /study/flashcards/:flashcardId/review
  reviewFlashcard = asyncHandler(async (req, res) => {
    const result = await this.studyService.reviewFlashcard(req.user.id, req.params.flashcardId, req.body.rating)
    return apiResponse.success(res, { data: result })
  })

  // POST /study/quizzes/:quizId/attempts
  saveAttempt = asyncHandler(async (req, res) => {
    const attempt = await this.studyService.saveAttempt(req.user.id, req.params.quizId, req.body)
    return apiResponse.success(res, { data: attempt, message: 'Intento guardado.', status: 201 })
  })
}
