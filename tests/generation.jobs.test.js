import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'
import { createContainer } from '../src/container.js'
import { createLogger } from '../src/config/logger.js'
import { BadGatewayError, UnprocessableEntityError } from '../src/errors/httpErrors.js'
import { createFakeSupabase } from './helpers/fakeSupabase.js'

const TOKEN = 'valid-user-token'
const OTHER_TOKEN = 'other-user-token'
const AUDIO = Buffer.from('fake audio bytes')
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

// Respuesta de POST /study-material/ de noto-ai-server (snake_case)
const AI_RESPONSE = {
  notes: {
    title: 'Fotosíntesis',
    content: [{ type: 'heading1', text: 'Fotosíntesis', emoji: '🌱' }, { type: 'paragraph', text: 'Texto', emoji: '' }],
    language: 'es',
    summary: 'Resumen de la clase',
    action_items: ['Leer el capítulo 3'],
    support_material: [],
    homework: ['Ejercicios 1-5'],
  },
  flashcards: { language: 'es', title: 'Fotosíntesis', cards: [{ front: '¿Dónde ocurre?', back: 'En el cloroplasto' }] },
  quiz: {
    language: 'es',
    title: 'Fotosíntesis',
    questions: [
      { question: '¿Qué pigmento capta la luz?', options: ['Clorofila', 'Melanina'], correct_option_index: 0, explanation: 'Es verde' },
    ],
  },
}

/**
 * Promesa que se resuelve desde afuera (para "pausar" la IA y observar el estado intermedio).
 */
function deferred() {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

/**
 * Cliente de IA falso: registra las llamadas (con el contenido del archivo) y responde solo lo pedido.
 */
function createFakeAiClient() {
  return {
    calls: [],
    error: null,
    gate: null,
    async createStudyMaterial(params) {
      const fileContent = await readFile(params.file.path, 'utf8')
      this.calls.push({ ...params, fileContent })

      if (this.gate) {
        await new Promise((resolve, reject) => {
          this.gate.promise.then(resolve)
          params.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }
      if (this.error) throw this.error
      return {
        notes: params.materials.includes('notes') ? AI_RESPONSE.notes : null,
        flashcards: params.materials.includes('flashcards') ? AI_RESPONSE.flashcards : null,
        quiz: params.materials.includes('quiz') ? AI_RESPONSE.quiz : null,
      }
    },
  }
}

/**
 * Preparador falso: no convierte nada y "detecta" 2 minutos de duración.
 */
function createFakePreparer() {
  return {
    calls: [],
    error: null,
    async prepare(params) {
      this.calls.push(params)
      if (this.error) throw this.error
      return { path: params.path, mimeType: params.mimeType, sizeBytes: params.sizeBytes, durationSec: 120, normalized: false }
    },
  }
}

describe('Generation Module - trabajos asíncronos', () => {
  let app
  let container
  let aiClient
  let preparer
  let tmpDir

  async function buildApp(envOverrides = {}) {
    const fakeSupabase = createFakeSupabase()
    for (const [id, token] of [['usr_1', TOKEN], ['usr_2', OTHER_TOKEN]]) {
      fakeSupabase._internal.usersAuth.set(id, {
        id,
        email: `${id}@noto.com`,
        token,
        user_metadata: { first_name: 'Ana', last_name: 'López' },
        email_confirmed_at: new Date().toISOString(),
      })
    }

    const testEnv = {
      NODE_ENV: 'test',
      CORS_ORIGINS: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
      GENERATION_TMP_DIR: tmpDir,
      GENERATION_MAX_FILE_SIZE_MB: 500,
      GENERATION_RETENTION_HOURS: 24,
      ...envOverrides,
    }
    const logger = createLogger(testEnv)
    aiClient = createFakeAiClient()
    preparer = createFakePreparer()

    container = createContainer({
      env: testEnv,
      supabaseAdmin: fakeSupabase,
      createAnonClient: () => fakeSupabase,
      logger,
      notoAiClient: aiClient,
      audioPreparer: preparer,
    })
    app = createApp({ container, env: testEnv, logger })
  }

  // outputType null = no enviar el campo
  const create = (
    outputType = 'full',
    { file = AUDIO, filename = 'clase.webm', contentType = 'audio/webm', token = TOKEN, fields = {} } = {}
  ) => {
    let req = request(app).post('/api/v1/generation/create').set('Authorization', `Bearer ${token}`)
    if (outputType !== null) req = req.field('outputType', outputType)
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value)
    if (file) req = req.attach('file', file, { filename, contentType })
    return req
  }
  const get = (id, token = TOKEN) => request(app).get(`/api/v1/generation/${id}`).set('Authorization', `Bearer ${token}`)
  const action = (id, name, body) => {
    const req = request(app).post(`/api/v1/generation/${id}/${name}`).set('Authorization', `Bearer ${TOKEN}`)
    return body ? req.send(body) : req
  }
  const idle = () => container.generationService.whenIdle()
  const filesInTmp = () => readdir(tmpDir)

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'noto-gen-test-'))
    await buildApp()
  })

  afterEach(async () => {
    await idle()
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ===== Crear =====
  it('debe rechazar la petición sin token (401) sin guardar el archivo ni llamar a la IA', async () => {
    const res = await request(app)
      .post('/api/v1/generation/create')
      .field('outputType', 'full')
      .attach('file', AUDIO, { filename: 'clase.webm', contentType: 'audio/webm' })

    expect(res.status).toBe(401)
    expect(aiClient.calls).toHaveLength(0)
    expect(await filesInTmp()).toHaveLength(0)
  })

  it('debe responder 202 enseguida y generar los tres materiales en segundo plano con una sola llamada', async () => {
    const res = await create('full', { fields: { originType: 'file', originalName: 'Clase 4.mp4', originalSize: '1500000000' } })

    expect(res.status).toBe(202)
    expect(res.body.data).toMatchObject({
      status: 'queued',
      title: 'Clase 4',
      outputType: 'full',
      pendingMaterials: ['notes', 'flashcards', 'quiz'],
      materials: [],
      content: { notes: null, flashcards: null, quiz: null },
      audio: { available: true },
      error: null,
    })
    expect(res.body.data.source).toMatchObject({ originType: 'file', originalName: 'Clase 4.mp4', originalSizeBytes: 1500000000 })
    // Nunca se expone la ruta del archivo en disco
    expect(JSON.stringify(res.body)).not.toContain(tmpDir)

    await idle()
    const done = await get(res.body.data.id)

    expect(done.status).toBe(200)
    expect(done.body.data).toMatchObject({
      status: 'completed',
      title: 'Fotosíntesis',
      materials: ['notes', 'flashcards', 'quiz'],
      pendingMaterials: [],
      source: { durationSec: 120 },
      audio: { available: true, mimeType: 'audio/webm' },
    })
    expect(done.body.data.content.notes.blocks[0]).toEqual({ type: 'heading1', text: 'Fotosíntesis', emoji: '🌱' })
    expect(done.body.data.content.quiz.questions[0].correctOptionIndex).toBe(0)
    expect(done.body.data.finishedAt).toBeTruthy()

    // La IA recibe el JWT del usuario, el archivo desde disco y los materiales en una sola llamada
    expect(aiClient.calls).toHaveLength(1)
    expect(aiClient.calls[0]).toMatchObject({ accessToken: TOKEN, materials: ['notes', 'flashcards', 'quiz'], fileContent: 'fake audio bytes' })
    expect(preparer.calls[0]).toMatchObject({ mimeType: 'audio/webm', sizeBytes: AUDIO.length })
  })

  it.each([
    ['flashcards', ['flashcards']],
    ['quiz', ['quiz']],
  ])('outputType "%s" debe pedir solo %j', async (outputType, materials) => {
    const res = await create(outputType)
    await idle()

    expect(aiClient.calls[0].materials).toEqual(materials)
    expect((await get(res.body.data.id)).body.data.materials).toEqual(materials)
  })

  it('debe mostrar el estado "processing" mientras la IA trabaja', async () => {
    aiClient.gate = deferred()
    const { body } = await create('quiz')

    await new Promise((r) => setTimeout(r, 20))
    expect((await get(body.data.id)).body.data.status).toBe('processing')

    aiClient.gate.resolve()
    await idle()
    expect((await get(body.data.id)).body.data.status).toBe('completed')
  })

  // ===== Consultar =====
  it('debe listar solo los trabajos del usuario, del más reciente al más antiguo', async () => {
    const first = await create('quiz')
    await new Promise((r) => setTimeout(r, 5))
    const second = await create('flashcards')
    await create('full', { token: OTHER_TOKEN })
    await idle()

    const res = await request(app).get('/api/v1/generation').set('Authorization', `Bearer ${TOKEN}`)

    expect(res.status).toBe(200)
    expect(res.body.data.map((job) => job.id)).toEqual([second.body.data.id, first.body.data.id])
  })

  it('debe responder 404 si el trabajo es de otro usuario o no existe, y 400 si el id no es válido', async () => {
    const { body } = await create('quiz')

    expect((await get(body.data.id, OTHER_TOKEN)).status).toBe(404)
    expect((await get(UNKNOWN_ID)).body.error.code).toBe('GENERATION_NOT_FOUND')
    expect((await get('no-es-uuid')).status).toBe(400)
  })

  // ===== Errores, reintento y cancelación =====
  it('debe registrar el error de la IA conservando el audio y permitir reintentar', async () => {
    aiClient.error = new UnprocessableEntityError('No se pudo transcribir el audio.', 'TRANSCRIPTION_FAILED')
    const { body } = await create('full')
    await idle()

    const failed = (await get(body.data.id)).body.data
    expect(failed).toMatchObject({
      status: 'failed',
      error: { code: 'TRANSCRIPTION_FAILED', message: 'No se pudo transcribir el audio.', statusCode: 422 },
      audio: { available: true },
      pendingMaterials: ['notes', 'flashcards', 'quiz'],
    })

    aiClient.error = null
    const retry = await action(body.data.id, 'retry')
    expect(retry.status).toBe(202)
    expect(retry.body.data).toMatchObject({ status: 'queued', error: null })
    await idle()

    expect((await get(body.data.id)).body.data.status).toBe('completed')
    expect(aiClient.calls).toHaveLength(2)
    // El audio ya estaba preparado: no se vuelve a convertir
    expect(preparer.calls).toHaveLength(1)
  })

  it('debe fallar con AUDIO_TOO_LONG sin llamar a la IA si el audio supera 2 horas', async () => {
    preparer.error = new UnprocessableEntityError('El audio supera el límite de 2 horas.', 'AUDIO_TOO_LONG')
    const { body } = await create('full')
    await idle()

    expect((await get(body.data.id)).body.data.error.code).toBe('AUDIO_TOO_LONG')
    expect(aiClient.calls).toHaveLength(0)
  })

  it('debe cancelar un trabajo en curso y poder reintentarlo después', async () => {
    aiClient.gate = deferred()
    aiClient.error = new BadGatewayError('no debería verse', 'AI_SERVICE_ERROR')
    const { body } = await create('quiz')
    await new Promise((r) => setTimeout(r, 20))

    const cancel = await action(body.data.id, 'cancel')
    expect(cancel.status).toBe(200)
    expect(cancel.body.data.status).toBe('cancelled')

    await idle()
    // El proceso en segundo plano no pisa el estado cancelado con su error
    expect((await get(body.data.id)).body.data).toMatchObject({ status: 'cancelled', error: null })

    aiClient.gate = null
    aiClient.error = null
    await action(body.data.id, 'retry')
    await idle()
    expect((await get(body.data.id)).body.data.status).toBe('completed')
  })

  it('debe responder 409 al cancelar o reintentar un trabajo que ya terminó', async () => {
    const { body } = await create('quiz')
    await idle()

    expect((await action(body.data.id, 'cancel')).body.error.code).toBe('JOB_NOT_ACTIVE')
    const retry = await action(body.data.id, 'retry')
    expect(retry.status).toBe(409)
    expect(retry.body.error.code).toBe('JOB_NOT_RETRYABLE')
  })

  // ===== Generar más material =====
  it('debe generar solo los materiales que faltan con el audio guardado y unirlos al contenido', async () => {
    const { body } = await create('flashcards')
    await idle()

    const more = await action(body.data.id, 'materials', { materials: ['notes', 'quiz', 'flashcards'] })
    expect(more.status).toBe(202)
    expect(more.body.data.pendingMaterials).toEqual(['notes', 'quiz'])
    // Mientras se genera lo nuevo, lo que ya existía se sigue viendo
    expect(more.body.data.content.flashcards).not.toBeNull()
    await idle()

    const done = (await get(body.data.id)).body.data
    expect(done.materials).toEqual(['notes', 'flashcards', 'quiz'])
    expect(aiClient.calls[1].materials).toEqual(['notes', 'quiz'])
  })

  it('debe responder 400 si el material pedido ya existe', async () => {
    const { body } = await create('quiz')
    await idle()

    const res = await action(body.data.id, 'materials', { materials: ['quiz'] })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('NOTHING_TO_GENERATE')
  })

  // ===== Audio guardado y retención =====
  it('debe servir el audio guardado al dueño', async () => {
    const { body } = await create('quiz')
    await idle()

    const res = await request(app)
      .get(`/api/v1/generation/${body.data.id}/audio`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = []
        r.on('data', (c) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('audio/webm')
    expect(res.body.toString()).toBe('fake audio bytes')
  })

  it('debe borrar los audios vencidos y responder 410 AUDIO_EXPIRED al reintentar', async () => {
    await buildApp({ GENERATION_RETENTION_HOURS: 0.000001 }) // ≈ 4 ms
    aiClient.error = new BadGatewayError('falló', 'AI_GENERATION_FAILED')
    const { body } = await create('quiz')
    await idle()
    await new Promise((r) => setTimeout(r, 10))

    expect(await container.generationService.purgeExpiredAudio()).toBe(1)
    expect(await filesInTmp()).toHaveLength(0)

    const job = (await get(body.data.id)).body.data
    expect(job.audio.available).toBe(false)
    const retry = await action(body.data.id, 'retry')
    expect(retry.status).toBe(410)
    expect(retry.body.error.code).toBe('AUDIO_EXPIRED')
  })

  // ===== Validación de la subida =====
  it('debe exigir el archivo (400 FILE_REQUIRED)', async () => {
    const res = await create('full', { file: null })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('FILE_REQUIRED')
  })

  it.each([['summary'], [null]])(
    'debe rechazar outputType inválido o faltante (%s) y borrar el archivo recibido',
    async (outputType) => {
      const res = await create(outputType)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(await filesInTmp()).toHaveLength(0)
    }
  )

  it('debe rechazar campos adicionales (400) y borrar el archivo recibido', async () => {
    const res = await create('full', { fields: { extra: 'x' } })
    expect(res.status).toBe(400)
    expect(await filesInTmp()).toHaveLength(0)
  })

  it('debe rechazar archivos que no son audio ni video (400 INVALID_FILE_TYPE)', async () => {
    const res = await create('full', { filename: 'notas.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE')
  })

  it('debe aceptar un MIME genérico si la extensión es de audio', async () => {
    const res = await create('quiz', { filename: 'clase.mp3', contentType: 'application/octet-stream' })
    expect(res.status).toBe(202)
  })

  it('debe rechazar archivos que superan el límite (413 FILE_TOO_LARGE) sin dejar basura en disco', async () => {
    await buildApp({ GENERATION_MAX_FILE_SIZE_MB: 0.00001 }) // ≈ 10 bytes
    const res = await create('full')

    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('FILE_TOO_LARGE')
    expect(await filesInTmp()).toHaveLength(0)
  })
})
