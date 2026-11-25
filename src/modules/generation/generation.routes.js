import { Router } from 'express'
import { createGenerationSchema } from './generation.schemas.js'

/**
 * Fábrica de rutas del módulo de generación de material de estudio.
 * @param {object} dependencies
 * @param {import('./generation.controller.js').GenerationController} dependencies.generationController
 * @param {object} dependencies.rateLimiters
 * @param {import('express').RequestHandler} dependencies.authenticate
 * @param {(schema: any) => import('express').RequestHandler} dependencies.validate
 * @param {(fieldName: string) => import('express').RequestHandler} dependencies.mediaUpload
 */
export function createGenerationRouter({ generationController, rateLimiters, authenticate, validate, mediaUpload }) {
  const router = Router()

  // POST /generation/create (multipart: file + outputType [+ metadatos])
  // El orden importa: primero se autentica (para no recibir archivos de anónimos), después
  // multer lee el multipart y por último se validan los campos de texto que dejó en req.body.
  router.post(
    '/create',
    authenticate,
    rateLimiters.generation,
    mediaUpload('file'),
    validate(createGenerationSchema),
    generationController.create
  )

  return router
}
