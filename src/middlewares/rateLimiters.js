import rateLimit from 'express-rate-limit'
import { TooManyRequestsError } from '../errors/httpErrors.js'

/**
 * Fábrica de limitadores de tasa (rate limiting).
 */
export function createRateLimiters() {
  const handler = (_req, _res, next) => {
    next(
      new TooManyRequestsError(
        'Has superado el límite de peticiones permitido. Por favor, intenta de nuevo más tarde.',
        'RATE_LIMITED'
      )
    )
  }

  // Limitador general: 100 peticiones cada 15 minutos por IP
  const general = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler,
  })

  // Limitador estricto para autenticación: 10 peticiones cada 15 minutos por IP
  const auth = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler,
  })

  return { general, auth }
}
