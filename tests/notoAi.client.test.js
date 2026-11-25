import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NotoAiClient } from '../src/modules/generation/noto-ai.client.js'

const FILE = { buffer: Buffer.from('audio'), originalName: 'clase.webm', mimeType: 'audio/webm' }
const OK_BODY = { notes: null, flashcards: { language: 'es', title: 'T', cards: [] }, quiz: null }

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Construye el cliente con un fetch falso que registra la petición y responde lo indicado.
 * @param {(url: string, init: object) => Promise<Response> | Response} handler
 */
function buildClient(handler, baseUrl = 'http://ai.local:8000/') {
  const requests = []
  const client = new NotoAiClient({
    baseUrl,
    timeoutMs: 5000,
    fetchImpl: async (url, init) => {
      requests.push({ url, init })
      return handler(url, init)
    },
  })
  return { client, requests }
}

const call = (client, materials = ['notes', 'flashcards', 'quiz']) =>
  client.createStudyMaterial({ accessToken: 'user-jwt', file: FILE, materials })

describe('NotoAiClient', () => {
  it('debe enviar el multipart a /study-material/ con el JWT del usuario en access-token', async () => {
    const { client, requests } = buildClient(() => jsonResponse(200, OK_BODY))

    const result = await call(client)

    expect(result).toEqual(OK_BODY)
    expect(requests).toHaveLength(1)
    const { url, init } = requests[0]
    expect(url).toBe('http://ai.local:8000/study-material/') // sin doble "/"
    expect(init.method).toBe('POST')
    expect(init.headers['access-token']).toBe('user-jwt')
    expect(init.signal).toBeInstanceOf(AbortSignal)

    // Un solo archivo y "materials" repetido (lo que espera FastAPI para list[MaterialType])
    expect(init.body.getAll('materials')).toEqual(['notes', 'flashcards', 'quiz'])
    const audio = init.body.get('audio_file')
    expect(audio.name).toBe('clase.webm')
    expect(audio.type).toBe('audio/webm')
    expect(Buffer.from(await audio.arrayBuffer()).toString()).toBe('audio')
  })

  it('debe leer el audio desde disco cuando recibe una ruta (archivos grandes)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'noto-ai-client-'))
    try {
      const filePath = path.join(dir, 'clase.webm')
      await writeFile(filePath, 'audio desde disco')
      const { client, requests } = buildClient(() => jsonResponse(200, OK_BODY))

      await client.createStudyMaterial({
        accessToken: 'user-jwt',
        file: { path: filePath, originalName: 'Clase 4.webm', mimeType: 'audio/webm' },
        materials: ['quiz'],
      })

      const audio = requests[0].init.body.get('audio_file')
      expect(audio.name).toBe('Clase 4.webm')
      expect(audio.type).toBe('audio/webm')
      expect(Buffer.from(await audio.arrayBuffer()).toString()).toBe('audio desde disco')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('debe propagar la cancelación del usuario a la petición', async () => {
    const controller = new AbortController()
    const { client, requests } = buildClient(() => jsonResponse(200, OK_BODY))

    await client.createStudyMaterial({ accessToken: 'jwt', file: FILE, materials: ['quiz'], signal: controller.signal })
    controller.abort()

    expect(requests[0].init.signal.aborted).toBe(true)
  })

  it.each([
    [422, { detail: 'Transcription failed: empty audio' }, 422, 'TRANSCRIPTION_FAILED'],
    [422, { detail: [{ loc: ['body', 'materials'], msg: 'Field required' }] }, 502, 'AI_BAD_REQUEST'],
    [401, { detail: 'Invalid or expired token' }, 502, 'AI_AUTH_REJECTED'],
    [502, { detail: 'Generation failed: llm down' }, 502, 'AI_GENERATION_FAILED'],
    [500, { detail: 'Internal Server Error' }, 502, 'AI_SERVICE_ERROR'],
    [504, null, 504, 'AI_TIMEOUT'],
  ])('debe traducir el status %i de la IA (%j) a %i %s', async (aiStatus, body, status, code) => {
    const { client } = buildClient(() =>
      body ? jsonResponse(aiStatus, body) : new Response('Gateway Timeout', { status: aiStatus })
    )

    await expect(call(client)).rejects.toMatchObject({ status, code })
  })

  it('debe responder 503 si la IA no está disponible', async () => {
    const { client } = buildClient(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
    })

    await expect(call(client)).rejects.toMatchObject({ status: 503, code: 'AI_SERVICE_UNAVAILABLE' })
  })

  it.each([
    ['AbortSignal.timeout', () => new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
    ['headersTimeout de undici', () => new TypeError('fetch failed', { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } })],
  ])('debe responder 504 si se agota el tiempo (%s)', async (_name, makeError) => {
    const { client } = buildClient(() => {
      throw makeError()
    })

    await expect(call(client)).rejects.toMatchObject({ status: 504, code: 'AI_TIMEOUT' })
  })

  it('debe responder 502 si la IA devuelve 200 sin JSON', async () => {
    const { client } = buildClient(() => new Response('<html>oops</html>', { status: 200 }))

    await expect(call(client)).rejects.toMatchObject({ status: 502, code: 'AI_INVALID_RESPONSE' })
  })
})
