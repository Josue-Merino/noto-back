import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createContainer } from '../src/container.js'
import { createLogger } from '../src/config/logger.js'
import { BadGatewayError, UnprocessableEntityError } from '../src/errors/httpErrors.js'
import { createFakeSupabase } from './helpers/fakeSupabase.js'

const TOKEN = 'valid-user-token'
const AUDIO = Buffer.from('fake audio bytes')

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
  flashcards: {
    language: 'es',
    title: 'Fotosíntesis',
    cards: [{ front: '¿Dónde ocurre?', back: 'En el cloroplasto' }],
  },
  quiz: {
    language: 'es',
    title: 'Fotosíntesis',
    questions: [
      { question: '¿Qué pigmento capta la luz?', options: ['Clorofila', 'Melanina'], correct_option_index: 0, explanation: 'Es verde' },
    ],
  },
}

/**
 * Cliente de IA falso: registra las llamadas y responde solo los materiales pedidos.
 */
function createFakeAiClient() {
  return {
    calls: [],
    error: null,
    async createStudyMaterial(params) {
      this.calls.push(params)
      if (this.error) throw this.error
      return {
        notes: params.materials.includes('notes') ? AI_RESPONSE.notes : null,
        flashcards: params.materials.includes('flashcards') ? AI_RESPONSE.flashcards : null,
        quiz: params.materials.includes('quiz') ? AI_RESPONSE.quiz : null,
      }
    },
  }
}

describe('Generation Module - POST /api/v1/generation/create', () => {
  let app
  let aiClient

  function buildApp(envOverrides = {}) {
    const fakeSupabase = createFakeSupabase()
    // Usuario autenticado: el middleware valida el token con auth.getUser
    fakeSupabase._internal.usersAuth.set('usr_1', {
      id: 'usr_1',
      email: 'ana@noto.com',
      token: TOKEN,
      user_metadata: { first_name: 'Ana', last_name: 'López' },
      email_confirmed_at: new Date().toISOString(),
    })

    const testEnv = {
      NODE_ENV: 'test',
      PORT: 3000,
      FRONTEND_URL: 'http://localhost:5173',
      CORS_ORIGINS: 'http://localhost:5173',
      SUPABASE_URL: 'https://fake-project.supabase.co',
      SUPABASE_ANON_KEY: 'fake-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key',
      EMAIL_REDIRECT_URL: 'http://localhost:5173/login',
      PASSWORD_RESET_REDIRECT_URL: 'http://localhost:5173/reset-password',
      LOG_LEVEL: 'silent',
      NOTO_AI_URL: 'http://localhost:8000',
      NOTO_AI_TIMEOUT_MS: 1000,
      GENERATION_MAX_FILE_SIZE_MB: 500,
      ...envOverrides,
    }
    const testLogger = createLogger(testEnv)
    aiClient = createFakeAiClient()

    const container = createContainer({
      env: testEnv,
      supabaseAdmin: fakeSupabase,
      createAnonClient: () => fakeSupabase,
      logger: testLogger,
      notoAiClient: aiClient,
    })
    return createApp({ container, env: testEnv, logger: testLogger })
  }

  // outputType null = no enviar el campo
  const post = (outputType = 'full', { file = AUDIO, filename = 'clase.webm', contentType = 'audio/webm' } = {}) => {
    let req = request(app).post('/api/v1/generation/create').set('Authorization', `Bearer ${TOKEN}`)
    if (outputType !== null) req = req.field('outputType', outputType)
    if (file) req = req.attach('file', file, { filename, contentType })
    return req
  }

  beforeEach(() => {
    app = buildApp()
  })

  // ===== Autenticación =====
  it('debe rechazar la petición sin token (401) y no llamar a la IA', async () => {
    const response = await request(app)
      .post('/api/v1/generation/create')
      .field('outputType', 'full')
      .attach('file', AUDIO, { filename: 'clase.webm', contentType: 'audio/webm' })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
    expect(aiClient.calls).toHaveLength(0)
  })

  // ===== Generación =====
  it('debe generar notas, flashcards y cuestionario con outputType "full" en una sola llamada (201)', async () => {
    const response = await post('full')
      .field('originType', 'file')
      .field('originalName', 'Biología_Clase_3.mp4')
      .field('originalSize', '104857600')
      .field('durationSec', '3125.4')

    expect(response.status).toBe(201)
    expect(response.body.success).toBe(true)

    // La IA se llama UNA vez, con el JWT del usuario y los tres materiales
    expect(aiClient.calls).toHaveLength(1)
    const call = aiClient.calls[0]
    expect(call.accessToken).toBe(TOKEN)
    expect(call.materials).toEqual(['notes', 'flashcards', 'quiz'])
    expect(call.file.originalname).toBe('clase.webm')
    expect(call.file.mimetype).toBe('audio/webm')
    expect(Buffer.compare(call.file.buffer, AUDIO)).toBe(0)

    const data = response.body.data
    expect(data.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(data.title).toBe('Fotosíntesis')
    expect(data.outputType).toBe('full')
    expect(Date.parse(data.createdAt)).not.toBeNaN()
    expect(data.source).toEqual({
      originType: 'file',
      originalName: 'Biología_Clase_3.mp4',
      mimeType: 'audio/webm',
      sizeBytes: AUDIO.length,
      originalSizeBytes: 104857600,
      durationSec: 3125.4,
    })

    // Mapeo snake_case (IA) → camelCase (backend)
    expect(data.content.notes).toEqual({
      title: 'Fotosíntesis',
      language: 'es',
      summary: 'Resumen de la clase',
      blocks: [
        { type: 'heading1', text: 'Fotosíntesis', emoji: '🌱' },
        { type: 'paragraph', text: 'Texto', emoji: null },
      ],
      actionItems: ['Leer el capítulo 3'],
      supportMaterial: [],
      homework: ['Ejercicios 1-5'],
    })
    expect(data.content.flashcards.cards).toEqual([{ front: '¿Dónde ocurre?', back: 'En el cloroplasto' }])
    expect(data.content.quiz.questions[0]).toEqual({
      question: '¿Qué pigmento capta la luz?',
      options: ['Clorofila', 'Melanina'],
      correctOptionIndex: 0,
      explanation: 'Es verde',
    })
  })

  it.each([
    ['flashcards', ['flashcards']],
    ['quiz', ['quiz']],
  ])('debe pedir solo el material de "%s"', async (outputType, materials) => {
    const response = await post(outputType)

    expect(response.status).toBe(201)
    expect(aiClient.calls[0].materials).toEqual(materials)
    const { content } = response.body.data
    expect(content.notes).toBeNull()
    expect(content.flashcards === null).toBe(outputType !== 'flashcards')
    expect(content.quiz === null).toBe(outputType !== 'quiz')
  })

  it('debe usar el nombre del archivo como título si la IA no devuelve uno', async () => {
    aiClient.createStudyMaterial = async () => ({ notes: null, flashcards: { language: 'es', title: '', cards: [] }, quiz: null })

    const response = await post('flashcards', { filename: 'Mi clase.webm' })

    expect(response.status).toBe(201)
    expect(response.body.data.title).toBe('Mi clase')
  })

  // ===== Validación =====
  it('debe exigir el archivo (400 FILE_REQUIRED)', async () => {
    const response = await post('full', { file: null })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('FILE_REQUIRED')
    expect(aiClient.calls).toHaveLength(0)
  })

  it.each([['summary'], [null]])('debe rechazar outputType inválido o faltante: %s (400)', async (outputType) => {
    const response = await post(outputType)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.details[0].field).toBe('outputType')
    expect(aiClient.calls).toHaveLength(0)
  })

  it('debe rechazar campos adicionales (400)', async () => {
    const response = await post('full').field('materials', 'notes')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('debe rechazar archivos que no son audio ni video (400 INVALID_FILE_TYPE)', async () => {
    const response = await post('full', { filename: 'apuntes.txt', contentType: 'text/plain' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_FILE_TYPE')
  })

  it('debe aceptar un MIME genérico si la extensión es de audio', async () => {
    const response = await post('quiz', { filename: 'clase.m4a', contentType: 'application/octet-stream' })

    expect(response.status).toBe(201)
  })

  it('debe rechazar archivos que superan el límite (413 FILE_TOO_LARGE)', async () => {
    app = buildApp({ GENERATION_MAX_FILE_SIZE_MB: 0.001 }) // ~1 KB
    const response = await post('full', { file: Buffer.alloc(4096) })

    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('FILE_TOO_LARGE')
    expect(aiClient.calls).toHaveLength(0)
  })

  // ===== Errores de la IA =====
  it('debe propagar el error de transcripción (422 TRANSCRIPTION_FAILED)', async () => {
    aiClient.error = new UnprocessableEntityError('No se pudo transcribir el audio.', 'TRANSCRIPTION_FAILED')
    const response = await post('full')

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('TRANSCRIPTION_FAILED')
  })

  it('debe propagar la falla de la IA como 502 sin cerrar la sesión', async () => {
    aiClient.error = new BadGatewayError('El servicio de IA no pudo validar la sesión del usuario.', 'AI_AUTH_REJECTED')
    const response = await post('full')

    expect(response.status).toBe(502)
    expect(response.body.error.code).toBe('AI_AUTH_REJECTED')
  })
})
