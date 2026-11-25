import multer from 'multer'
import { AppError } from '../errors/AppError.js'
import { BadRequestError, PayloadTooLargeError } from '../errors/httpErrors.js'

// Extensiones aceptadas cuando el navegador no manda un MIME de audio/video (p. ej. octet-stream)
const MEDIA_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.mp4', '.mov', '.webm', '.ogg', '.opus', '.aac', '.flac']

/**
 * Indica si un archivo subido es audio o video (por MIME o, en su defecto, por extensión).
 * @param {{ mimetype?: string, originalname?: string }} file
 * @returns {boolean}
 */
export function isMediaFile(file) {
  const mime = (file.mimetype || '').toLowerCase()
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return true

  const name = (file.originalname || '').toLowerCase()
  return MEDIA_EXTENSIONS.some((ext) => name.endsWith(ext))
}

/**
 * Traduce los errores de multer/busboy al formato uniforme de AppError.
 * @param {unknown} err
 * @param {string} fieldName
 * @param {number} maxFileSizeBytes
 * @returns {AppError | unknown}
 */
function toAppError(err, fieldName, maxFileSizeBytes) {
  if (err instanceof AppError) return err

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const maxMb = Math.round((maxFileSizeBytes / (1024 * 1024)) * 100) / 100
      return new PayloadTooLargeError(
        `El archivo supera el tamaño máximo permitido de ${maxMb} MB.`,
        'FILE_TOO_LARGE'
      )
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
      return new BadRequestError(
        `Envía un solo archivo en el campo "${fieldName}".`,
        'UNEXPECTED_FILE_FIELD'
      )
    }
  }

  // Cuerpo multipart malformado o cortado a la mitad
  return new BadRequestError('No se pudo leer el archivo enviado.', 'INVALID_UPLOAD')
}

/**
 * Fábrica de middlewares de subida de un archivo multimedia (audio o video) en memoria.
 * Deja el archivo en `req.file` ({ buffer, originalname, mimetype, size }) y los campos de texto en `req.body`.
 * @param {object} options
 * @param {number} options.maxFileSizeBytes - Tamaño máximo aceptado por archivo.
 * @returns {(fieldName: string) => import('express').RequestHandler}
 */
export function createMediaUpload({ maxFileSizeBytes }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSizeBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (isMediaFile(file)) return cb(null, true)
      cb(new BadRequestError('Formato no soportado. Sube un archivo de audio o video.', 'INVALID_FILE_TYPE'))
    },
  })

  return function single(fieldName) {
    const handler = upload.single(fieldName)

    return function mediaUpload(req, res, next) {
      handler(req, res, (err) => {
        if (err) return next(toAppError(err, fieldName, maxFileSizeBytes))

        if (!req.file) {
          return next(
            new BadRequestError('Debes adjuntar un archivo de audio o video.', 'FILE_REQUIRED', [
              { field: fieldName, message: 'El archivo es obligatorio' },
            ])
          )
        }

        next()
      })
    }
  }
}
