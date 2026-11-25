/**
 * Helpers para responder con formato uniforme en la API.
 */
export const apiResponse = {
  /**
   * Respuesta exitosa uniforme.
   * @param {import('express').Response} res
   * @param {object} options
   * @param {any} [options.data] - Carga útil de datos.
   * @param {string} [options.message] - Mensaje opcional.
   * @param {number} [options.status] - Código de estado HTTP (default: 200).
   */
  success(res, { data = null, message = null, status = 200 } = {}) {
    return res.status(status).json({
      success: true,
      data,
      message,
    })
  },

  /**
   * Respuesta de error uniforme.
   * @param {import('express').Response} res
   * @param {object} options
   * @param {string} options.code - Código de error estandarizado.
   * @param {string} options.message - Mensaje comprensible en español.
   * @param {any} [options.details] - Detalles de validación o campos.
   * @param {number} [options.status] - Código HTTP (default: 400).
   */
  fail(res, { code = 'BAD_REQUEST', message = 'Ocurrió un error', details = null, status = 400 } = {}) {
    return res.status(status).json({
      success: false,
      error: {
        code,
        message,
        details,
      },
    })
  },
}
