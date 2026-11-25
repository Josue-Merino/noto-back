/**
 * Clase base para errores controlados de la aplicación.
 */
export class AppError extends Error {
  /**
   * @param {string} message - Mensaje descriptivo en español para el cliente.
   * @param {number} status - Código de estado HTTP (400, 401, 403, 404, 409, 429, 500).
   * @param {string} code - Código de error semántico (ej. VALIDATION_ERROR).
   * @param {Array<object> | null} [details] - Detalles adicionales (por ejemplo campos inválidos).
   */
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message)
    this.name = this.constructor.name
    this.status = status
    this.code = code
    this.details = details
    this.isOperational = true

    Error.captureStackTrace(this, this.constructor)
  }
}
