import { Agent, fetch as undiciFetch, FormData } from 'undici'
import {
  BadGatewayError,
  GatewayTimeoutError,
  ServiceUnavailableError,
  UnprocessableEntityError,
} from '../../errors/httpErrors.js'

// Códigos de undici cuando se agota alguno de sus timeouts
const UNDICI_TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT'])

/**
 * @param {any} err
 * @returns {boolean}
 */
function isTimeoutError(err) {
  return (
    err?.name === 'TimeoutError' ||
    err?.name === 'AbortError' ||
    UNDICI_TIMEOUT_CODES.has(err?.code) ||
    UNDICI_TIMEOUT_CODES.has(err?.cause?.code) ||
    err?.cause?.name === 'TimeoutError'
  )
}

/**
 * Cliente HTTP del servicio de IA (noto-ai-server).
 * Es la única clase del backend que habla con la IA: arma el multipart, reenvía el JWT del usuario
 * y traduce las respuestas de error a AppError.
 */
export class NotoAiClient {
  /**
   * @param {object} dependencies
   * @param {string} dependencies.baseUrl - URL base de noto-ai-server (NOTO_AI_URL).
   * @param {number} dependencies.timeoutMs - Tiempo máximo de espera de la generación completa.
   * @param {import('pino').Logger} [dependencies.logger]
   * @param {typeof fetch} [dependencies.fetchImpl] - Inyectable para pruebas.
   * @param {import('undici').Dispatcher} [dependencies.dispatcher]
   */
  constructor({ baseUrl, timeoutMs, logger, fetchImpl, dispatcher }) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '')
    this.timeoutMs = timeoutMs
    this.logger = logger
    this.fetchImpl = fetchImpl ?? undiciFetch
    // El fetch de Node corta a los 300 s si no llegan los headers; la IA puede tardar más que eso
    // en responder una clase larga, así que se usa un Agent con el mismo timeout de la generación.
    this.dispatcher =
      dispatcher ?? (fetchImpl ? undefined : new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs }))
  }

  /**
   * Transcribe el audio una sola vez y genera los materiales pedidos.
   * @param {object} params
   * @param {string} params.accessToken - JWT de Supabase del usuario (se reenvía en `access-token`).
   * @param {{ buffer: Buffer, originalname?: string, mimetype?: string }} params.file
   * @param {Array<'notes' | 'flashcards' | 'quiz'>} params.materials
   * @returns {Promise<{ notes: object | null, flashcards: object | null, quiz: object | null }>}
   */
  async createStudyMaterial({ accessToken, file, materials }) {
    const form = new FormData()
    form.append(
      'audio_file',
      new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' }),
      file.originalname || 'audio'
    )
    for (const material of materials) {
      form.append('materials', material)
    }

    const startedAt = Date.now()
    let response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/study-material/`, {
        method: 'POST',
        headers: { 'access-token': accessToken },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
        dispatcher: this.dispatcher,
      })
    } catch (err) {
      throw this.#toRequestError(err)
    }

    const payload = await this.#readJson(response)
    this.logger?.info(
      { status: response.status, materials, durationMs: Date.now() - startedAt },
      'Respuesta del servicio de IA'
    )

    if (!response.ok) {
      throw this.#toResponseError(response.status, payload)
    }
    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayError('El servicio de IA devolvió una respuesta inválida.', 'AI_INVALID_RESPONSE')
    }
    return payload
  }

  /**
   * Lee el cuerpo JSON; si no es JSON devuelve null (salvo timeout, que se propaga como 504).
   * @param {Response} response
   */
  async #readJson(response) {
    try {
      return await response.json()
    } catch (err) {
      if (isTimeoutError(err)) throw this.#toRequestError(err)
      return null
    }
  }

  /**
   * Error antes de recibir respuesta: timeout o servicio caído / inaccesible.
   * @param {any} err
   */
  #toRequestError(err) {
    if (isTimeoutError(err)) {
      this.logger?.error({ timeoutMs: this.timeoutMs }, 'El servicio de IA no respondió a tiempo')
      return new GatewayTimeoutError(
        'La generación tardó demasiado y se canceló. Intenta de nuevo con un audio más corto.',
        'AI_TIMEOUT'
      )
    }

    this.logger?.error(
      { baseUrl: this.baseUrl, cause: err?.cause?.code || err?.message },
      'No se pudo conectar con el servicio de IA'
    )
    return new ServiceUnavailableError(
      'El servicio de IA no está disponible en este momento. Intenta más tarde.',
      'AI_SERVICE_UNAVAILABLE'
    )
  }

  /**
   * Traduce el status de noto-ai-server a un AppError del backend.
   * @param {number} status
   * @param {any} payload - Cuerpo de error de FastAPI: { detail: string | Array }.
   */
  #toResponseError(status, payload) {
    const detail = typeof payload?.detail === 'string' ? payload.detail : null
    this.logger?.warn({ status, detail: detail ?? payload?.detail }, 'El servicio de IA respondió con error')

    // Un 401 de la IA es un problema de configuración entre servicios (p. ej. proyectos de Supabase
    // distintos), no una sesión vencida: se responde 502 para que el frontend no cierre la sesión.
    if (status === 401 || status === 403) {
      return new BadGatewayError(
        'El servicio de IA no pudo validar la sesión del usuario.',
        'AI_AUTH_REJECTED'
      )
    }

    if (status === 422 && detail?.startsWith('Transcription failed')) {
      return new UnprocessableEntityError(
        'No se pudo transcribir el audio. Verifica que el archivo tenga voz audible y un formato válido.',
        'TRANSCRIPTION_FAILED'
      )
    }

    if (status === 422) {
      return new BadGatewayError('El servicio de IA rechazó la solicitud.', 'AI_BAD_REQUEST')
    }

    if (status === 502 && detail?.startsWith('Generation failed')) {
      return new BadGatewayError(
        'El servicio de IA no pudo generar el material de estudio. Intenta de nuevo.',
        'AI_GENERATION_FAILED'
      )
    }

    if (status === 504) {
      return new GatewayTimeoutError('El servicio de IA tardó demasiado en responder.', 'AI_TIMEOUT')
    }

    return new BadGatewayError('El servicio de IA respondió con un error inesperado.', 'AI_SERVICE_ERROR')
  }
}
