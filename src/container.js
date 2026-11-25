import ffmpegStaticPath from 'ffmpeg-static'
import { UserRepository } from './modules/users/user.repository.js'
import { AuthService } from './modules/auth/auth.service.js'
import { AuthController } from './modules/auth/auth.controller.js'
import { GENERATION_DEFAULTS } from './modules/generation/generation.config.js'
import { NotoAiClient } from './modules/generation/noto-ai.client.js'
import { GenerationService } from './modules/generation/generation.service.js'
import { GenerationController } from './modules/generation/generation.controller.js'
import { InMemoryGenerationJobRepository } from './modules/generation/generationJob.repository.js'
import { TempDiskAudioStorage } from './modules/generation/audio.storage.js'
import { FfmpegAudioPreparer } from './modules/generation/audio.preparer.js'
import { SupabaseStudyMaterialStore } from './modules/study/study.store.supabase.js'
import { StudyService } from './modules/study/study.service.js'
import { StudyController } from './modules/study/study.controller.js'
import { createRateLimiters } from './middlewares/rateLimiters.js'
import { createAuthenticateMiddleware } from './middlewares/authenticate.js'
import { createErrorHandler } from './middlewares/errorHandler.js'
import { createMediaUpload } from './middlewares/upload.js'
import { validate } from './middlewares/validate.js'

/**
 * Contenedor de inversión de control e inyección de dependencias manual.
 * Centraliza la creación de repositorios, servicios, controladores y middlewares.
 * @param {object} dependencies
 * @param {object} dependencies.env
 * @param {import('@supabase/supabase-js').SupabaseClient} dependencies.supabaseAdmin
 * @param {() => import('@supabase/supabase-js').SupabaseClient} dependencies.createAnonClient
 * @param {import('pino').Logger} dependencies.logger
 * @param {{ createStudyMaterial: Function }} [dependencies.notoAiClient] - Inyectable para pruebas.
 * @param {{ prepare: Function }} [dependencies.audioPreparer] - Inyectable para pruebas.
 * @param {string} [dependencies.ffmpegPath] - Binario de ffmpeg (por defecto, el de `ffmpeg-static`).
 * @param {object} [dependencies.studyStore] - Store del material (por defecto, las tablas de Supabase).
 */
export function createContainer({
  env,
  supabaseAdmin,
  createAnonClient,
  logger,
  notoAiClient,
  audioPreparer,
  ffmpegPath = ffmpegStaticPath,
  studyStore,
}) {
  const userRepository = new UserRepository({ supabaseAdmin })

  const authService = new AuthService({
    userRepository,
    createAnonClient,
    adminClient: supabaseAdmin,
    env,
    logger,
  })

  const authController = new AuthController({ authService })

  // Generación de material de estudio (servicio de IA). Los valores de GENERATION_DEFAULTS son el
  // respaldo cuando el env es parcial (p. ej. en las pruebas de otros módulos).
  const config = { ...GENERATION_DEFAULTS, ...definedOnly(env) }
  const aiClient =
    notoAiClient ??
    new NotoAiClient({ baseUrl: config.NOTO_AI_URL, timeoutMs: config.NOTO_AI_TIMEOUT_MS, logger })
  const audioStorage = new TempDiskAudioStorage({ directory: config.GENERATION_TMP_DIR })
  const preparer =
    audioPreparer ??
    new FfmpegAudioPreparer({
      ffmpegPath,
      maxDurationSec: config.GENERATION_MAX_DURATION_SEC,
      normalizeAboveBytes: config.GENERATION_NORMALIZE_ABOVE_MB * 1024 * 1024,
      audioStorage,
      logger,
    })
  // Material de estudio: tablas note/block, mazo/flashcard y cuestionario/pregunta/opcion de Supabase
  const materialStore = studyStore ?? new SupabaseStudyMaterialStore({ supabaseAdmin })
  const studyService = new StudyService({ studyStore: materialStore, logger })
  const studyController = new StudyController({ studyService })

  const generationService = new GenerationService({
    jobRepository: new InMemoryGenerationJobRepository(),
    studyStore: materialStore,
    audioStorage,
    audioPreparer: preparer,
    notoAiClient: aiClient,
    retentionMs: config.GENERATION_RETENTION_HOURS * 60 * 60 * 1000,
    logger,
  })
  const generationController = new GenerationController({ generationService })
  const mediaUpload = createMediaUpload({
    // multer exige un entero de bytes
    maxFileSizeBytes: Math.floor(config.GENERATION_MAX_FILE_SIZE_MB * 1024 * 1024),
    directory: config.GENERATION_TMP_DIR,
  })

  const rateLimiters = createRateLimiters()
  const authenticate = createAuthenticateMiddleware({ supabaseAdmin })
  const errorHandler = createErrorHandler({ logger })

  return {
    userRepository,
    authService,
    authController,
    notoAiClient: aiClient,
    generationService,
    generationController,
    studyStore: materialStore,
    studyService,
    studyController,
    mediaUpload,
    rateLimiters,
    authenticate,
    validate,
    errorHandler,
    supabaseAdmin,
    logger,
    env,
  }
}

/**
 * Quita las claves sin valor para que no pisen los valores por defecto.
 * @param {Record<string, unknown>} obj
 */
function definedOnly(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined))
}
