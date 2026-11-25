import { BadRequestError } from '../errors/httpErrors.js'

/**
 * Middleware de validación con Zod para body, query o params.
 * Reemplaza el objeto de la petición con los datos ya saneados y transformados.
 * @param {import('zod').ZodSchema} schema
 * @param {'body' | 'query' | 'params'} [source]
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source])

    if (!result.success) {
      const formattedDetails = result.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }))

      throw new BadRequestError(
        'Los datos proporcionados no son válidos.',
        'VALIDATION_ERROR',
        formattedDetails
      )
    }

    // Sobrescribir con los datos parseados y tipados de Zod
    req[source] = result.data
    next()
  }
}
