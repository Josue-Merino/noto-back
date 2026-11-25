import { UserRepository } from './modules/users/user.repository.js'
import { AuthService } from './modules/auth/auth.service.js'
import { AuthController } from './modules/auth/auth.controller.js'
import { GENERATION_DEFAULTS } from './modules/generation/generation.config.js'
import { NotoAiClient } from './modules/generation/noto-ai.client.js'
import { GenerationService } from './modules/generation/generation.service.js'
import { GenerationController } from './modules/generation/generation.controller.js'
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
 */
export function createContainer({
  env,
  supabaseAdmin,
  createAnonClient,
  logger,
  notoAiClient,
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

  // Generación de material de estudio (servicio de IA)
  const aiClient =
    notoAiClient ??
    new NotoAiClient({
      baseUrl: env.NOTO_AI_URL ?? GENERATION_DEFAULTS.NOTO_AI_URL,
      timeoutMs: env.NOTO_AI_TIMEOUT_MS ?? GENERATION_DEFAULTS.NOTO_AI_TIMEOUT_MS,
      logger,
    })
  const generationService = new GenerationService({ notoAiClient: aiClient, logger })
  const generationController = new GenerationController({ generationService })
  const maxFileSizeMb = env.GENERATION_MAX_FILE_SIZE_MB ?? GENERATION_DEFAULTS.GENERATION_MAX_FILE_SIZE_MB
  const mediaUpload = createMediaUpload({
    // multer exige un entero de bytes
    maxFileSizeBytes: Math.floor(maxFileSizeMb * 1024 * 1024),
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
