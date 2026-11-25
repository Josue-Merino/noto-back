import { Router } from 'express'
import { discardUploadOnError } from '../../middlewares/upload.js'
import { addMaterialsSchema, createGenerationSchema, generationIdParamsSchema } from './generation.schemas.js'

/**
 * Fábrica de rutas del módulo de generación de material de estudio.
 * @param {object} dependencies
 * @param {import('./generation.controller.js').GenerationController} dependencies.generationController
 * @param {object} dependencies.rateLimiters
 * @param {import('express').RequestHandler} dependencies.authenticate
 * @param {(schema: any, source?: string) => import('express').RequestHandler} dependencies.validate
 * @param {(fieldName: string) => import('express').RequestHandler} dependencies.mediaUpload
 */
export function createGenerationRouter({ generationController, rateLimiters, authenticate, validate, mediaUpload }) {
  const router = Router()
  const validId = validate(generationIdParamsSchema, 'params')

  // POST /generation/create (multipart: file + outputType [+ metadatos]) → 202 + trabajo
  // El orden importa: primero se autentica (para no recibir archivos de anónimos), después
  // multer guarda el archivo en disco y por último se validan los campos de texto de req.body.
  // Si algo falla después de recibir el archivo, `discardUploadOnError` lo borra del disco.
  router.post(
    '/create',
    authenticate,
    rateLimiters.generation,
    mediaUpload('file'),
    validate(createGenerationSchema),
    generationController.create,
    discardUploadOnError
  )

  // Consultas (el frontend consulta el estado cada pocos segundos): límite propio, más amplio
  router.get('/', authenticate, rateLimiters.polling, generationController.list)
  router.get('/:id', authenticate, rateLimiters.polling, validId, generationController.get)
  router.get('/:id/audio', authenticate, rateLimiters.polling, validId, generationController.audio)

  // Acciones sobre un trabajo
  router.post('/:id/cancel', authenticate, validId, generationController.cancel)
  router.post('/:id/retry', authenticate, rateLimiters.generation, validId, generationController.retry)
  router.post(
    '/:id/materials',
    authenticate,
    rateLimiters.generation,
    validId,
    validate(addMaterialsSchema),
    generationController.addMaterials
  )

  return router
}
