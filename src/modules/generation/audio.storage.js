import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Almacén de audios en una carpeta temporal del disco.
 * Los audios se conservan después de procesarse para poder reintentar, generar más material
 * y reproducir el audio original; el barrido de retención los borra al vencer.
 */
export class TempDiskAudioStorage {
  /**
   * @param {object} options
   * @param {string} options.directory - Misma carpeta donde multer deja los archivos recibidos.
   */
  constructor({ directory }) {
    this.directory = directory
    mkdirSync(directory, { recursive: true })
  }

  /**
   * Ruta nueva (todavía sin crear) dentro del almacén.
   * @param {string} extension - Con punto, p. ej. ".webm".
   */
  createPath(extension) {
    return path.join(this.directory, `${randomUUID()}${extension}`)
  }

  /**
   * @param {string | null | undefined} filePath
   * @returns {Promise<boolean>}
   */
  async exists(filePath) {
    if (!filePath) return false
    try {
      return (await stat(filePath)).isFile()
    } catch {
      return false
    }
  }

  /**
   * @param {string | null | undefined} filePath
   */
  async remove(filePath) {
    if (filePath) await rm(filePath, { force: true }).catch(() => {})
  }
}
