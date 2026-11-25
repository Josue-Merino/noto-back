import { UserRepository } from './modules/users/user.repository.js'
import { AuthService } from './modules/auth/auth.service.js'
import { AuthController } from './modules/auth/auth.controller.js'
import { createRateLimiters } from './middlewares/rateLimiters.js'
import { createAuthenticateMiddleware } from './middlewares/authenticate.js'
import { createErrorHandler } from './middlewares/errorHandler.js'
import { validate } from './middlewares/validate.js'

/**
 * Contenedor de inversión de control e inyección de dependencias manual.
 * Centraliza la creación de repositorios, servicios, controladores y middlewares.
 * @param {object} dependencies
 */
export function createContainer({
  env,
  supabaseAdmin,
  createAnonClient,
  logger,
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
  const rateLimiters = createRateLimiters()
  const authenticate = createAuthenticateMiddleware({ supabaseAdmin })
  const errorHandler = createErrorHandler({ logger })

  return {
    userRepository,
    authService,
    authController,
    rateLimiters,
    authenticate,
    validate,
    errorHandler,
    supabaseAdmin,
    logger,
    env,
  }
}
