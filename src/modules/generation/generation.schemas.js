import { z } from 'zod'

/** Tipos de salida que ofrece el frontend. */
export const OUTPUT_TYPES = ['flashcards', 'quiz', 'full']

/** Origen del audio: archivo subido o grabación desde el navegador. */
export const ORIGIN_TYPES = ['file', 'recording']

// Los campos de un multipart llegan como texto: '' se trata como "no enviado"
const emptyToUndefined = (val) => (val === '' ? undefined : val)

/**
 * Campos de texto del multipart de POST /generation/create (el archivo lo valida el middleware de subida).
 */
export const createGenerationSchema = z
  .object({
    outputType: z.enum(OUTPUT_TYPES, {
      errorMap: (issue) => ({
        message:
          issue.code === 'invalid_type'
            ? 'El tipo de salida es obligatorio'
            : 'El tipo de salida debe ser flashcards, quiz o full',
      }),
    }),
    originType: z.preprocess(emptyToUndefined, z.enum(ORIGIN_TYPES).optional()),
    originalName: z.preprocess(
      emptyToUndefined,
      z.string().trim().max(255, 'El nombre del archivo no puede exceder 255 caracteres').optional()
    ),
    originalSize: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int('El tamaño original debe ser un entero').nonnegative().optional()
    ),
    durationSec: z.preprocess(
      emptyToUndefined,
      z.coerce.number().nonnegative('La duración no puede ser negativa').optional()
    ),
  })
  .strict('No se permiten campos adicionales')
