import { NotFoundError } from '../errors/httpErrors.js'

/**
 * Middleware para rutas no encontradas (404 uniforme).
 */
export function notFound(req, _res, next) {
  next(
    new NotFoundError(
      `La ruta ${req.method} ${req.originalUrl} no fue encontrada en este servidor.`,
      'NOT_FOUND'
    )
  )
}
