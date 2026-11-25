import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
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
 * Borra el archivo que multer dejó en disco (si lo hay). No falla si ya no existe.
 * @param {import('express').Request} req
 */
export async function discardUploadedFile(req) {
  if (req.file?.path) {
    await rm(req.file.path, { force: true }).catch(() => {})
  }
}

/**
 * Middleware de error: si la petición falla después de recibir el archivo (p. ej. validación),
 * borra el archivo temporal y deja pasar el error.
 * @type {import('express').ErrorRequestHandler}
 */
export function discardUploadOnError(err, req, _res, next) {
  discardUploadedFile(req).finally(() => next(err))
}

/**
 * Fábrica de middlewares de subida de un archivo multimedia (audio o video) **a disco**.
 * Un archivo de hasta 1.5 GB no puede vivir en memoria: multer lo escribe por partes en `directory`.
 * Deja el archivo en `req.file` ({ path, originalname, mimetype, size }) y los campos de texto en `req.body`.
 * @param {object} options
 * @param {number} options.maxFileSizeBytes - Tamaño máximo aceptado por archivo.
 * @param {string} options.directory - Carpeta donde se guardan los archivos recibidos.
 * @returns {(fieldName: string) => import('express').RequestHandler}
 */
export function createMediaUpload({ maxFileSizeBytes, directory }) {
  mkdirSync(directory, { recursive: true })

  const upload = multer({
    storage: multer.diskStorage({
      destination: directory,
      // Nombre aleatorio + extensión original (ffmpeg la usa para reconocer el formato)
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname || '').toLowerCase()}`),
    }),
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
        // multer ya borra el archivo parcial cuando falla la subida
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
