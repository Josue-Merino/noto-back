import { Router } from 'express'
import { flashcardParamsSchema, quizParamsSchema, reviewFlashcardSchema, saveAttemptSchema } from './study.schemas.js'

/**
 * Fábrica de rutas del repaso.
 * @param {object} dependencies
 * @param {import('./study.controller.js').StudyController} dependencies.studyController
 * @param {object} dependencies.rateLimiters
 * @param {import('express').RequestHandler} dependencies.authenticate
 * @param {(schema: any, source?: string) => import('express').RequestHandler} dependencies.validate
 */
export function createStudyRouter({ studyController, rateLimiters, authenticate, validate }) {
  const router = Router()

  // Repasar envía una petición por tarjeta: límite propio, más amplio que el general
  router.post(
    '/flashcards/:flashcardId/review',
    authenticate,
    rateLimiters.study,
    validate(flashcardParamsSchema, 'params'),
    validate(reviewFlashcardSchema),
    studyController.reviewFlashcard
  )

  router.post(
    '/quizzes/:quizId/attempts',
    authenticate,
    rateLimiters.study,
    validate(quizParamsSchema, 'params'),
    validate(saveAttemptSchema),
    studyController.saveAttempt
  )

  return router
}
