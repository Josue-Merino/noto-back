import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { FfmpegAudioPreparer } from '../src/modules/generation/audio.preparer.js'
import { TempDiskAudioStorage } from '../src/modules/generation/audio.storage.js'

const run = promisify(execFile)

/**
 * Pruebas con el ffmpeg real de `ffmpeg-static` y archivos sintéticos de pocos segundos.
 */
describe('FfmpegAudioPreparer', () => {
  let dir
  let storage
  let audioPath // WAV de 4 s, ~128 KB
  let videoPath // MP4 de 3 s con audio

  const build = (overrides = {}) =>
    new FfmpegAudioPreparer({
      ffmpegPath,
      maxDurationSec: 7200,
      normalizeAboveBytes: 25 * 1024 * 1024,
      audioStorage: storage,
      ...overrides,
    })

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'noto-preparer-'))
    storage = new TempDiskAudioStorage({ directory: dir })
    audioPath = path.join(dir, 'tono.wav')
    videoPath = path.join(dir, 'clase.mp4')
    await run(ffmpegPath, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-ac', '1', '-ar', '16000', audioPath])
    await run(ffmpegPath, [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=5:duration=3',
      '-shortest', videoPath,
    ])
  }, 30000)

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('debe leer la duración y dejar el audio liviano sin convertir', async () => {
    const { size } = await stat(audioPath)
    const result = await build().prepare({ path: audioPath, mimeType: 'audio/wav', sizeBytes: size })

    expect(result).toMatchObject({ path: audioPath, mimeType: 'audio/wav', normalized: false })
    expect(result.durationSec).toBeCloseTo(4, 0)
  })

  it('debe rechazar con AUDIO_TOO_LONG un audio que supera la duración máxima', async () => {
    const { size } = await stat(audioPath)
    await expect(
      build({ maxDurationSec: 2 }).prepare({ path: audioPath, mimeType: 'audio/wav', sizeBytes: size })
    ).rejects.toMatchObject({ status: 422, code: 'AUDIO_TOO_LONG' })
  })

  it('debe convertir un video a Opus (audio/webm) y borrar el original', async () => {
    const copy = path.join(dir, 'video-copia.mp4')
    await run(ffmpegPath, ['-hide_banner', '-y', '-i', videoPath, '-c', 'copy', copy])
    const { size } = await stat(copy)

    const result = await build().prepare({ path: copy, mimeType: 'video/mp4', sizeBytes: size })

    expect(result).toMatchObject({ mimeType: 'audio/webm', normalized: true })
    expect(result.path.endsWith('.webm')).toBe(true)
    expect(result.durationSec).toBeCloseTo(3, 0)
    expect(await storage.exists(copy)).toBe(false)
    expect(await storage.exists(result.path)).toBe(true)
  }, 30000)

  it('debe convertir un audio que pesa más del umbral', async () => {
    const copy = path.join(dir, 'tono-copia.wav')
    await run(ffmpegPath, ['-hide_banner', '-y', '-i', audioPath, '-c', 'copy', copy])
    const { size } = await stat(copy)

    const result = await build({ normalizeAboveBytes: 1024 }).prepare({ path: copy, mimeType: 'audio/wav', sizeBytes: size })

    expect(result.normalized).toBe(true)
    expect(result.sizeBytes).toBeLessThan(size)
  }, 30000)

  it('debe rechazar con PREPARATION_FAILED un archivo sin pista de audio', async () => {
    const fake = path.join(dir, 'falso.mp3')
    await writeFile(fake, 'esto no es audio')

    await expect(
      build().prepare({ path: fake, mimeType: 'audio/mpeg', sizeBytes: 16 })
    ).rejects.toMatchObject({ status: 422, code: 'PREPARATION_FAILED' })
  })

  it('debe usar la duración declarada si la cabecera no la trae y respetar el límite', async () => {
    // WebM generado por streaming (como MediaRecorder): sin duración en la cabecera
    const webm = path.join(dir, 'grabacion.webm')
    await run(ffmpegPath, ['-hide_banner', '-y', '-i', audioPath, '-c:a', 'libopus', '-f', 'webm', '-live', '1', webm])
    const { size } = await stat(webm)

    await expect(
      build({ maxDurationSec: 60 }).prepare({ path: webm, mimeType: 'audio/webm', sizeBytes: size, declaredDurationSec: 90 })
    ).rejects.toMatchObject({ code: 'AUDIO_TOO_LONG' })
  }, 30000)
})
