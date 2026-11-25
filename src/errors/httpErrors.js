import { AppError } from './AppError.js'

export class BadRequestError extends AppError {
  constructor(message = 'Solicitud inválida', code = 'BAD_REQUEST', details = null) {
    super(message, 400, code, details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autorizado', code = 'UNAUTHORIZED', details = null) {
    super(message, 401, code, details)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Acceso denegado', code = 'FORBIDDEN', details = null) {
    super(message, 403, code, details)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado', code = 'NOT_FOUND', details = null) {
    super(message, 404, code, details)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflicto con recurso existente', code = 'CONFLICT', details = null) {
    super(message, 409, code, details)
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'El contenido supera el tamaño máximo permitido', code = 'PAYLOAD_TOO_LARGE', details = null) {
    super(message, 413, code, details)
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = 'No se pudo procesar el contenido enviado', code = 'UNPROCESSABLE_ENTITY', details = null) {
    super(message, 422, code, details)
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Has superado el límite de peticiones', code = 'RATE_LIMITED', details = null) {
    super(message, 429, code, details)
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Error interno del servidor', code = 'INTERNAL_ERROR', details = null) {
    super(message, 500, code, details)
  }
}

export class BadGatewayError extends AppError {
  constructor(message = 'Un servicio externo respondió con un error', code = 'BAD_GATEWAY', details = null) {
    super(message, 502, code, details)
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'El servicio no está disponible en este momento', code = 'SERVICE_UNAVAILABLE', details = null) {
    super(message, 503, code, details)
  }
}

export class GatewayTimeoutError extends AppError {
  constructor(message = 'Un servicio externo tardó demasiado en responder', code = 'GATEWAY_TIMEOUT', details = null) {
    super(message, 504, code, details)
  }
}
