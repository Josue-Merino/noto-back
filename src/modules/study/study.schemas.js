import { z } from 'zod'
import { RATING_QUALITY } from './study.mappers.js'

/** Calificaciones de una flashcard: Otra vez / Difícil / Bien / Fácil. */
export const RATINGS = Object.keys(RATING_QUALITY)

/** Parámetro `:flashcardId`. */
export const flashcardParamsSchema = z.object({
  flashcardId: z.string().uuid('El identificador de la flashcard no es válido'),
})

/** Parámetro `:quizId`. */
export const quizParamsSchema = z.object({
  quizId: z.string().uuid('El identificador del cuestionario no es válido'),
})

/** Cuerpo de POST /study/flashcards/:flashcardId/review. */
export const reviewFlashcardSchema = z
  .object({
    rating: z.enum(RATINGS, {
      errorMap: () => ({ message: 'La calificación debe ser again, hard, good o easy' }),
    }),
  })
  .strict('No se permiten campos adicionales')

/** Cuerpo de POST /study/quizzes/:quizId/attempts. */
export const saveAttemptSchema = z
  .object({
    startedAt: z.string().datetime({ offset: true, message: 'La fecha de inicio no es válida' }).optional(),
    answers: z
      .array(
        z.object({
          questionId: z.string().uuid('El identificador de la pregunta no es válido'),
          optionId: z.string().uuid('El identificador de la opción no es válido').nullable(),
        })
      )
      .min(1, 'Responde al menos una pregunta')
      .max(200, 'Demasiadas respuestas'),
  })
  .strict('No se permiten campos adicionales')
