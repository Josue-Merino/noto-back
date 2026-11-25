import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { UnprocessableEntityError } from '../../errors/httpErrors.js'

// Mismos parámetros que la compresión del frontend: Opus mono 16 kHz 32 kbps (ideal para voz)
const NORMALIZE_ARGS = ['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip']
const NORMALIZED_MIME = 'audio/webm'
const NORMALIZED_EXTENSION = '.webm'

const DURATION_RE = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/
const PROGRESS_TIME_RE = /time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g
const AUDIO_STREAM_RE = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio:/

/**
 * @param {string} h
 * @param {string} m
 * @param {string} s
 */
const toSeconds = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s)

/**
 * Error que se lanza cuando se cancela la preparación.
 */
class PreparationAbortedError extends Error {
  constructor() {
    super('Preparación del audio cancelada')
    this.name = 'AbortError'
  }
}

/**
 * Prepara el audio antes de mandarlo a la IA, con ffmpeg (binario de `ffmpeg-static`):
 *
 * 1. Lee la duración y verifica que haya pista de audio.
 * 2. Rechaza audios de más de `maxDurationSec` (regla RN4: 2 horas).
 * 3. Si es video o pesa más de `normalizeAboveBytes`, lo convierte a Opus mono 16 kHz 32 kbps.
 *
 * Así noto-ai-server (que carga el archivo completo en memoria) nunca recibe 1.5 GB.
 */
export class FfmpegAudioPreparer {
  /**
   * @param {object} dependencies
   * @param {string} dependencies.ffmpegPath
   * @param {number} dependencies.maxDurationSec
   * @param {number} dependencies.normalizeAboveBytes
   * @param {import('./audio.storage.js').TempDiskAudioStorage} dependencies.audioStorage
   * @param {import('pino').Logger} [dependencies.logger]
   */
  constructor({ ffmpegPath, maxDurationSec, normalizeAboveBytes, audioStorage, logger }) {
    this.ffmpegPath = ffmpegPath
    this.maxDurationSec = maxDurationSec
    this.normalizeAboveBytes = normalizeAboveBytes
    this.audioStorage = audioStorage
    this.logger = logger
  }

  /**
   * @param {object} params
   * @param {string} params.path
   * @param {string} params.mimeType
   * @param {number} params.sizeBytes
   * @param {number | null} [params.declaredDurationSec] - Duración que informó el frontend (respaldo).
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<{ path: string, mimeType: string, sizeBytes: number, durationSec: number | null, normalized: boolean }>}
   */
  async prepare({ path: inputPath, mimeType, sizeBytes, declaredDurationSec = null, signal }) {
    // 1. Inspección: `ffmpeg -i` imprime la información del archivo y sale con error (no hay salida)
    const { stderr } = await this.#run(['-hide_banner', '-nostdin', '-i', inputPath], { signal, allowFailure: true })

    if (!AUDIO_STREAM_RE.test(stderr)) {
      throw new UnprocessableEntityError(
        'No se pudo leer el audio del archivo. Verifica que no esté dañado y que tenga sonido.',
        'PREPARATION_FAILED'
      )
    }

    const match = stderr.match(DURATION_RE)
    // Las grabaciones WebM del navegador no traen duración en la cabecera ("Duration: N/A")
    let durationSec = match ? toSeconds(match[1], match[2], match[3]) : declaredDurationSec
    this.#assertDuration(durationSec)

    // 2. Normalización (solo si hace falta)
    const isVideo = (mimeType || '').toLowerCase().startsWith('video/')
    if (!isVideo && sizeBytes <= this.normalizeAboveBytes) {
      return { path: inputPath, mimeType, sizeBytes, durationSec, normalized: false }
    }

    const outputPath = this.audioStorage.createPath(NORMALIZED_EXTENSION)
    const startedAt = Date.now()
    try {
      const { stderr: encodeLog } = await this.#run(
        ['-hide_banner', '-nostdin', '-y', '-i', inputPath, ...NORMALIZE_ARGS, outputPath],
        { signal }
      )
      // La duración real sale del último "time=" del progreso (sirve cuando la cabecera no la trae)
      const times = [...encodeLog.matchAll(PROGRESS_TIME_RE)]
      const last = times.at(-1)
      if (last) durationSec = Math.max(durationSec ?? 0, toSeconds(last[1], last[2], last[3]))
      this.#assertDuration(durationSec)
    } catch (err) {
      await this.audioStorage.remove(outputPath)
      throw err
    }

    const { size } = await stat(outputPath)
    await this.audioStorage.remove(inputPath)
    this.logger?.info(
      { originalBytes: sizeBytes, normalizedBytes: size, durationSec, ms: Date.now() - startedAt },
      'Audio normalizado a Opus antes de enviarlo a la IA'
    )
    return { path: outputPath, mimeType: NORMALIZED_MIME, sizeBytes: size, durationSec, normalized: true }
  }

  /**
   * @param {number | null} durationSec
   */
  #assertDuration(durationSec) {
    if (durationSec != null && durationSec > this.maxDurationSec) {
      const maxMinutes = Math.round(this.maxDurationSec / 60)
      throw new UnprocessableEntityError(
        `El audio supera el límite de ${maxMinutes} minutos. Recórtalo o divide la clase en varios archivos.`,
        'AUDIO_TOO_LONG',
        [{ field: 'durationSec', message: `Duración detectada: ${Math.round(durationSec / 60)} min` }]
      )
    }
  }

  /**
   * Ejecuta ffmpeg y junta stderr (ahí escribe la información y el progreso).
   * @param {string[]} args
   * @param {{ signal?: AbortSignal, allowFailure?: boolean }} options
   * @returns {Promise<{ code: number | null, stderr: string }>}
   */
  #run(args, { signal, allowFailure = false }) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new PreparationAbortedError())

      const child = spawn(this.ffmpegPath, args, { windowsHide: true })
      let stderr = ''
      child.stderr.on('data', (chunk) => {
        stderr += chunk
        // Solo interesa la cabecera y el último progreso: se recorta para no crecer sin límite
        if (stderr.length > 200_000) stderr = stderr.slice(0, 20_000) + stderr.slice(-20_000)
      })

      const onAbort = () => child.kill('SIGKILL')
      signal?.addEventListener('abort', onAbort, { once: true })

      child.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort)
        this.logger?.error({ err: err.message }, 'No se pudo ejecutar ffmpeg')
        reject(
          new UnprocessableEntityError('No se pudo procesar el audio en el servidor.', 'PREPARATION_FAILED')
        )
      })

      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort)
        if (signal?.aborted) return reject(new PreparationAbortedError())
        if (code !== 0 && !allowFailure) {
          this.logger?.warn({ code, tail: stderr.slice(-500) }, 'ffmpeg terminó con error')
          return reject(
            new UnprocessableEntityError(
              'No se pudo convertir el audio. Verifica que el archivo no esté dañado.',
              'PREPARATION_FAILED'
            )
          )
        }
        resolve({ code, stderr })
      })
    })
  }
}
