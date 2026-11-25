import { AppError } from '../errors/AppError.js'
import { apiResponse } from '../utils/apiResponse.js'

/**
 * Middleware global para captura y formateo uniforme de errores.
 * @param {object} dependencies
 * @param {import('pino').Logger} dependencies.logger
 */
export function createErrorHandler({ logger }) {
  return function errorHandler(err, req, res, _next) {
    const requestId = req.id || req.headers['x-request-id']

    // Error controlado de la aplicación (AppError)
    if (err instanceof AppError) {
      if (err.status >= 500) {
        logger.error({ err, requestId, url: req.originalUrl }, err.message)
      } else {
        logger.warn({ code: err.code, status: err.status, message: err.message, requestId }, 'Error operacional en cliente')
      }

      return apiResponse.fail(res, {
        status: err.status,
        code: err.code,
        message: err.message,
        details: err.details,
      })
    }

    // Error de sintaxis en JSON entrante
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return apiResponse.fail(res, {
        status: 400,
        code: 'INVALID_JSON',
        message: 'El cuerpo de la petición contiene un formato JSON inválido.',
      })
    }

    // Error de tamaño de cuerpo excedido (413 Payload Too Large)
    if (err.status === 413 || err.type === 'entity.too.large') {
      return apiResponse.fail(res, {
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'El tamaño de la petición o imagen supera el límite permitido por el servidor.',
      })
    }

    // Errores inesperados no controlados (500)
    logger.error({ err, requestId, url: req.originalUrl }, 'Excepción no controlada en la petición')

    return apiResponse.fail(res, {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error interno en el servidor. Por favor, intenta de nuevo más tarde.',
    })
  }
}
