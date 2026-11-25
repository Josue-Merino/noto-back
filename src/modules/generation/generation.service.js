import { randomUUID } from 'node:crypto'
import { contentFromAi, resolveTitle, toPublicDTO } from '../../models/studyMaterial.model.js'

/**
 * Materiales que se le piden a la IA por cada tipo de salida del frontend.
 * "full" pide los tres en UNA petición: la IA transcribe el audio una sola vez.
 */
export const MATERIALS_BY_OUTPUT_TYPE = Object.freeze({
  flashcards: ['flashcards'],
  quiz: ['quiz'],
  full: ['notes', 'flashcards', 'quiz'],
})

/**
 * Servicio de generación de material de estudio a partir de un audio.
 * Sin base de datos por ahora: el material vive solo en la respuesta HTTP.
 */
export class GenerationService {
  /**
   * @param {object} dependencies
   * @param {import('./noto-ai.client.js').NotoAiClient} dependencies.notoAiClient
   * @param {import('pino').Logger} [dependencies.logger]
   * @param {() => string} [dependencies.generateId]
   * @param {() => Date} [dependencies.now]
   */
  constructor({ notoAiClient, logger, generateId = randomUUID, now = () => new Date() }) {
    this.notoAiClient = notoAiClient
    this.logger = logger
    this.generateId = generateId
    this.now = now
  }

  /**
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.accessToken - JWT del usuario, se reenvía a la IA.
   * @param {{ buffer: Buffer, originalname: string, mimetype: string, size: number }} params.file
   * @param {'flashcards' | 'quiz' | 'full'} params.outputType
   * @param {'file' | 'recording'} [params.originType]
   * @param {string} [params.originalName]
   * @param {number} [params.originalSize]
   * @param {number} [params.durationSec]
   */
  async create({ userId, accessToken, file, outputType, originType, originalName, originalSize, durationSec }) {
    const materials = MATERIALS_BY_OUTPUT_TYPE[outputType]

    this.logger?.info(
      { userId, outputType, materials, sizeBytes: file.size, mimeType: file.mimetype },
      'Generando material de estudio'
    )

    const aiResult = await this.notoAiClient.createStudyMaterial({ accessToken, file, materials })
    const content = contentFromAi(aiResult)
    const name = originalName || file.originalname

    return toPublicDTO({
      id: this.generateId(),
      title: resolveTitle(content, name),
      outputType,
      createdAt: this.now().toISOString(),
      source: {
        originType,
        originalName: name,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        originalSizeBytes: originalSize,
        durationSec,
      },
      content,
    })
  }
}
