import { randomUUID } from 'node:crypto'
import { AppError } from '../../errors/AppError.js'
import { BadRequestError, ConflictError, GoneError, NotFoundError } from '../../errors/httpErrors.js'
import {
  ACTIVE_STATUSES,
  JOB_STATUS,
  MATERIAL_KEYS,
  contentFromAi,
  emptyContent,
  materialsIn,
  outputTypeFor,
  resolveTitle,
  toJobDTO,
} from '../../models/studyMaterial.model.js'

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
 * @param {string | undefined} name
 */
const titleFromFileName = (name) => name?.replace(/\.[^/.]+$/, '').trim() || 'Material de estudio'

/**
 * Generación **asíncrona** de material de estudio.
 *
 * `create` guarda el trabajo y responde enseguida (202); el procesamiento corre en segundo plano:
 * `queued → preparing (ffmpeg) → processing (IA) → completed | failed | cancelled`.
 * El frontend consulta el estado, así el usuario puede salir de la pantalla y el proceso de
 * una clase de dos horas no depende de mantener abierta una petición HTTP.
 *
 * El audio se conserva (hasta que vence) para reintentar, generar más material o reproducirlo.
 *
 * **Persistencia:** el estado de los trabajos en curso vive en memoria (el esquema de Supabase no
 * tiene dónde guardarlo). Al completarse, el material se guarda en Supabase como una `note` con
 * `note_id` = id del trabajo, y desde ese momento el contenido se lee de ahí. Si el backend se
 * reinicia, la nota sigue disponible por el mismo id (sin audio ni metadata del archivo).
 */
export class GenerationService {
  /** @type {Map<string, AbortController>} */
  #controllers = new Map()

  /** @type {Set<Promise<void>>} */
  #running = new Set()

  /**
   * @param {object} dependencies
   * @param {import('./generationJob.repository.js').InMemoryGenerationJobRepository} dependencies.jobRepository
   * @param {import('./audio.storage.js').TempDiskAudioStorage} dependencies.audioStorage
   * @param {{ prepare: Function }} dependencies.audioPreparer
   * @param {{ createStudyMaterial: Function }} dependencies.notoAiClient
   * @param {import('../study/study.store.supabase.js').SupabaseStudyMaterialStore} dependencies.studyStore
   * @param {number} dependencies.retentionMs - Tiempo que se conserva el audio.
   * @param {import('pino').Logger} [dependencies.logger]
   * @param {() => string} [dependencies.generateId]
   * @param {() => Date} [dependencies.now]
   */
  constructor({
    jobRepository,
    audioStorage,
    audioPreparer,
    notoAiClient,
    studyStore,
    retentionMs,
    logger,
    generateId = randomUUID,
    now = () => new Date(),
  }) {
    this.jobRepository = jobRepository
    this.audioStorage = audioStorage
    this.audioPreparer = audioPreparer
    this.notoAiClient = notoAiClient
    this.studyStore = studyStore
    this.retentionMs = retentionMs
    this.logger = logger
    this.generateId = generateId
    this.now = now
  }

  /**
   * Registra el trabajo con el archivo que ya dejó multer en disco y empieza a procesarlo.
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.accessToken - JWT del usuario, se reenvía a la IA.
   * @param {{ path: string, originalname: string, mimetype: string, size: number }} params.file
   * @param {'flashcards' | 'quiz' | 'full'} params.outputType
   * @param {'file' | 'recording'} [params.originType]
   * @param {string} [params.originalName]
   * @param {number} [params.originalSize]
   * @param {number} [params.durationSec]
   */
  async create({ userId, accessToken, file, outputType, originType, originalName, originalSize, durationSec }) {
    const now = this.#nowIso()
    const name = originalName || file.originalname

    const job = await this.jobRepository.create({
      id: this.generateId(),
      userId,
      status: JOB_STATUS.QUEUED,
      title: titleFromFileName(name),
      outputType,
      pendingMaterials: MATERIALS_BY_OUTPUT_TYPE[outputType],
      source: {
        originType,
        originalName: name,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        originalSizeBytes: originalSize,
        durationSec,
      },
      audio: { path: file.path, mimeType: file.mimetype, sizeBytes: file.size, prepared: false, expiresAt: this.#expiresAt() },
      content: emptyContent(),
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    })

    this.logger?.info(
      { jobId: job.id, userId, outputType, sizeBytes: file.size, mimeType: file.mimetype },
      'Trabajo de generación registrado'
    )
    this.#start(job.id, accessToken)
    return toJobDTO(job, { audioAvailable: true })
  }

  /**
   * @param {string} userId
   */
  async list(userId) {
    const [jobs, notes] = await Promise.all([this.jobRepository.listByUser(userId), this.studyStore.list(userId)])
    const pending = new Map(jobs.map((job) => [job.id, job]))

    // Notas guardadas (sin cargar su contenido) + trabajos que todavía no tienen nota
    const items = await Promise.all(
      notes.map((note) => {
        const job = pending.get(note.noteId)
        pending.delete(note.noteId)
        return this.#summaryDTO(job ?? this.#jobFromNote(userId, note), note)
      })
    )
    const others = await Promise.all([...pending.values()].map((job) => this.#toDTO(job)))
    return [...items, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * @param {string} userId
   * @param {string} jobId
   */
  async get(userId, jobId) {
    return this.#toDTO(await this.#findOwned(userId, jobId))
  }

  /**
   * Cancela un trabajo en curso. El audio se conserva para poder reintentarlo.
   * @param {string} userId
   * @param {string} jobId
   */
  async cancel(userId, jobId) {
    const job = await this.#findOwned(userId, jobId)
    if (!ACTIVE_STATUSES.includes(job.status)) {
      throw new ConflictError('La generación ya terminó; no se puede cancelar.', 'JOB_NOT_ACTIVE')
    }

    // Primero se aborta: desde aquí el proceso en segundo plano ya no escribe el trabajo
    this.#controllers.get(jobId)?.abort()
    const updated = await this.jobRepository.update(jobId, {
      status: JOB_STATUS.CANCELLED,
      finishedAt: this.#nowIso(),
      updatedAt: this.#nowIso(),
    })
    this.logger?.info({ jobId }, 'Generación cancelada por el usuario')
    return this.#toDTO(updated)
  }

  /**
   * Vuelve a procesar un trabajo fallido o cancelado con el audio que se conservó.
   * @param {string} userId
   * @param {string} jobId
   * @param {string} accessToken - Token vigente (el del primer intento pudo haber vencido).
   */
  async retry(userId, jobId, accessToken) {
    const job = await this.#findOwned(userId, jobId)
    if (![JOB_STATUS.FAILED, JOB_STATUS.CANCELLED].includes(job.status)) {
      throw new ConflictError('Solo se puede reintentar una generación fallida o cancelada.', 'JOB_NOT_RETRYABLE')
    }
    // Si la IA ya respondió y solo falló el guardado, se reintenta el guardado (sin volver a pagar la IA)
    if (!job.unsavedContent) await this.#assertAudioAvailable(job)
    return this.#requeue(job, job.pendingMaterials, accessToken)
  }

  /**
   * "Generar más material": vuelve a mandar el audio guardado pidiendo solo los materiales que faltan.
   * @param {string} userId
   * @param {string} jobId
   * @param {Array<'notes' | 'flashcards' | 'quiz'>} materials
   * @param {string} accessToken
   */
  async addMaterials(userId, jobId, materials, accessToken) {
    const job = await this.#findOwned(userId, jobId)
    if (ACTIVE_STATUSES.includes(job.status)) {
      throw new ConflictError('Espera a que termine la generación en curso.', 'JOB_ACTIVE')
    }

    const existing = job.persisted
      ? ((await this.studyStore.summary(userId, jobId))?.materials ?? [])
      : materialsIn(job.content)
    const missing = MATERIAL_KEYS.filter((key) => materials.includes(key) && !existing.includes(key))
    if (missing.length === 0) {
      throw new BadRequestError('Ese material ya está generado.', 'NOTHING_TO_GENERATE')
    }

    await this.#assertAudioAvailable(job)
    return this.#requeue(job, missing, accessToken)
  }

  /**
   * Audio guardado del trabajo (para reproducirlo en el frontend).
   * @param {string} userId
   * @param {string} jobId
   * @returns {Promise<{ path: string, mimeType: string, sizeBytes: number }>}
   */
  async getAudio(userId, jobId) {
    const job = await this.#findOwned(userId, jobId)
    await this.#assertAudioAvailable(job)
    return { path: job.audio.path, mimeType: job.audio.mimeType, sizeBytes: job.audio.sizeBytes }
  }

  /**
   * Borra los audios vencidos de trabajos que ya no están corriendo (el registro del trabajo se conserva).
   * @returns {Promise<number>} Cantidad de audios borrados.
   */
  async purgeExpiredAudio() {
    const now = this.now().getTime()
    let removed = 0
    for (const job of await this.jobRepository.listAll()) {
      const expired = job.audio?.path && new Date(job.audio.expiresAt).getTime() <= now
      if (expired && !ACTIVE_STATUSES.includes(job.status)) {
        await this.audioStorage.remove(job.audio.path)
        // Un trabajo ya guardado en Supabase no necesita seguir en memoria sin su audio
        if (job.persisted && !job.unsavedContent) await this.jobRepository.delete(job.id)
        else await this.jobRepository.update(job.id, { audio: { ...job.audio, path: null } })
        removed += 1
      }
    }
    if (removed > 0) this.logger?.info({ removed }, 'Audios vencidos eliminados')
    return removed
  }

  /**
   * Espera a que terminen los procesos en segundo plano (pruebas y cierre ordenado).
   */
  async whenIdle() {
    while (this.#running.size > 0) {
      await Promise.allSettled([...this.#running])
    }
  }

  // ===== Procesamiento en segundo plano =====

  /**
   * @param {object} job
   * @param {string[]} materials
   * @param {string} accessToken
   */
  async #requeue(job, materials, accessToken) {
    const updated = await this.jobRepository.update(job.id, {
      status: JOB_STATUS.QUEUED,
      pendingMaterials: materials,
      error: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: this.#nowIso(),
      audio: { ...job.audio, expiresAt: this.#expiresAt() },
    })
    this.#start(job.id, accessToken)
    return this.#toDTO(updated)
  }

  /**
   * @param {string} jobId
   * @param {string} accessToken
   */
  #start(jobId, accessToken) {
    const controller = new AbortController()
    this.#controllers.set(jobId, controller)

    const task = this.#process(jobId, accessToken, controller.signal).finally(() => {
      if (this.#controllers.get(jobId) === controller) this.#controllers.delete(jobId)
      this.#running.delete(task)
    })
    this.#running.add(task)
  }

  /**
   * Nunca lanza: cualquier error queda registrado en el trabajo.
   * @param {string} jobId
   * @param {string} accessToken
   * @param {AbortSignal} signal
   */
  async #process(jobId, accessToken, signal) {
    try {
      let job = await this.jobRepository.findById(jobId)

      // 1. Preparar el audio (duración + normalización); solo la primera vez
      if (!job.unsavedContent && !job.audio.prepared) {
        job = await this.#update(jobId, signal, {
          status: JOB_STATUS.PREPARING,
          startedAt: this.#nowIso(),
        })
        if (!job) return

        const prepared = await this.audioPreparer.prepare({
          path: job.audio.path,
          mimeType: job.audio.mimeType,
          sizeBytes: job.audio.sizeBytes,
          declaredDurationSec: job.source.durationSec ?? null,
          signal,
        })

        job = await this.#update(jobId, signal, {
          audio: {
            ...job.audio,
            path: prepared.path,
            mimeType: prepared.mimeType,
            sizeBytes: prepared.sizeBytes,
            prepared: true,
          },
          source: { ...job.source, durationSec: prepared.durationSec ?? job.source.durationSec ?? null },
        })
        if (!job) return
      }

      // 2. Transcribir y generar con la IA (salvo que ya se tenga la respuesta y solo faltara guardarla)
      job = await this.#update(jobId, signal, {
        status: JOB_STATUS.PROCESSING,
        startedAt: job.startedAt ?? this.#nowIso(),
      })
      if (!job) return

      let generated = job.unsavedContent
      if (!generated) {
        const aiResult = await this.notoAiClient.createStudyMaterial({
          accessToken,
          file: { path: job.audio.path, mimeType: job.audio.mimeType, originalName: job.source.originalName },
          materials: job.pendingMaterials,
          signal,
        })
        generated = contentFromAi(aiResult)
      }
      if (signal.aborted) return

      // 3. Guardar en Supabase solo el material nuevo (la nota se crea la primera vez)
      const title = job.persisted ? job.title : resolveTitle(generated, job.source.originalName)
      try {
        await this.studyStore.saveGenerated({ noteId: job.id, userId: job.userId, title, content: generated })
      } catch (err) {
        this.logger?.error({ jobId, err }, 'No se pudo guardar el material en Supabase')
        await this.jobRepository.update(jobId, {
          status: JOB_STATUS.FAILED,
          unsavedContent: generated,
          error: {
            code: 'PERSISTENCE_FAILED',
            message: 'Generamos tu material pero no pudimos guardarlo. Reintenta para guardarlo.',
            statusCode: 503,
          },
          finishedAt: this.#nowIso(),
          updatedAt: this.#nowIso(),
        })
        return
      }

      await this.jobRepository.update(jobId, {
        status: JOB_STATUS.COMPLETED,
        persisted: true,
        content: null,
        unsavedContent: null,
        title,
        pendingMaterials: [],
        finishedAt: this.#nowIso(),
        updatedAt: this.#nowIso(),
      })
      this.logger?.info({ jobId, materials: materialsIn(generated) }, 'Material de estudio generado y guardado')
    } catch (err) {
      if (signal.aborted) return // cancelado: `cancel` ya dejó el estado final

      const error =
        err instanceof AppError
          ? { code: err.code, message: err.message, statusCode: err.status }
          : { code: 'GENERATION_FAILED', message: 'Ocurrió un error inesperado al generar el material.', statusCode: 500 }

      if (!(err instanceof AppError)) this.logger?.error({ jobId, err }, 'Error inesperado en la generación')
      else this.logger?.warn({ jobId, code: err.code }, 'La generación falló')

      await this.jobRepository.update(jobId, {
        status: JOB_STATUS.FAILED,
        error,
        finishedAt: this.#nowIso(),
        updatedAt: this.#nowIso(),
      })
    }
  }

  /**
   * Actualiza el trabajo salvo que se haya cancelado mientras tanto.
   * @param {string} jobId
   * @param {AbortSignal} signal
   * @param {object} patch
   * @returns {Promise<object | null>} null si se canceló.
   */
  async #update(jobId, signal, patch) {
    if (signal.aborted) return null
    return this.jobRepository.update(jobId, { ...patch, updatedAt: this.#nowIso() })
  }

  // ===== Utilidades =====

  /**
   * El trabajo existe y es del usuario; si no, 404 (no se revela que existe).
   * @param {string} userId
   * @param {string} jobId
   */
  async #findOwned(userId, jobId) {
    const job = await this.jobRepository.findById(jobId)
    if (job && job.userId === userId) return job

    // Ya no está en memoria (p. ej. tras un reinicio): se busca la nota guardada
    const note = job ? null : await this.studyStore.summary(userId, jobId)
    if (!note) throw new NotFoundError('No encontramos este material.', 'GENERATION_NOT_FOUND')
    return this.#jobFromNote(userId, note)
  }

  /**
   * "Trabajo" equivalente a una nota guardada que ya no está en memoria (sin audio ni metadata del archivo).
   * @param {string} userId
   * @param {{ noteId: string, title: string, createdAt: string, updatedAt: string, materials: string[] }} note
   */
  #jobFromNote(userId, note) {
    return {
      id: note.noteId,
      userId,
      status: JOB_STATUS.COMPLETED,
      title: note.title,
      outputType: outputTypeFor(note.materials),
      pendingMaterials: [],
      source: {},
      audio: null,
      content: null,
      persisted: true,
      error: null,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      startedAt: null,
      finishedAt: note.updatedAt,
    }
  }

  /**
   * DTO de lista: sin contenido, con los materiales y conteos de la nota.
   * @param {object} job
   * @param {{ title: string, materials: string[], counts: object }} note
   */
  async #summaryDTO(job, note) {
    return toJobDTO(
      { ...job, title: note.title || job.title, content: null },
      { audioAvailable: await this.#isAudioAvailable(job), materials: note.materials, counts: note.counts }
    )
  }

  /**
   * @param {object} job
   */
  async #assertAudioAvailable(job) {
    if (!(await this.#isAudioAvailable(job))) {
      throw new GoneError(
        'El audio original ya no está disponible. Sube el archivo de nuevo para generar el material.',
        'AUDIO_EXPIRED'
      )
    }
  }

  /**
   * @param {object} job
   */
  async #isAudioAvailable(job) {
    const notExpired = new Date(job.audio?.expiresAt ?? 0).getTime() > this.now().getTime()
    return notExpired && (await this.audioStorage.exists(job.audio?.path))
  }

  /**
   * @param {object} job
   */
  async #toDTO(job) {
    const audioAvailable = await this.#isAudioAvailable(job)
    if (!job.persisted) return toJobDTO(job, { audioAvailable })

    // Material guardado: el contenido (con ids de tarjetas, preguntas e intentos) sale de Supabase
    const note = await this.studyStore.load(job.userId, job.id)
    return toJobDTO(
      { ...job, title: note?.title || job.title, content: note?.content ?? emptyContent() },
      { audioAvailable }
    )
  }

  #nowIso() {
    return this.now().toISOString()
  }

  #expiresAt() {
    return new Date(this.now().getTime() + this.retentionMs).toISOString()
  }
}
