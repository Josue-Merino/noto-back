import crypto from 'node:crypto'

/**
 * Middleware para asignar y propagar un identificador único por petición (X-Request-Id).
 */
export function requestId(req, res, next) {
  const existingId = req.headers['x-request-id']
  const id = existingId && typeof existingId === 'string' ? existingId : crypto.randomUUID()

  req.id = id
  res.setHeader('X-Request-Id', id)
  next()
}
