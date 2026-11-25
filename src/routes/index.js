import { Router } from 'express'
import { apiResponse } from '../utils/apiResponse.js'
import { createAuthRouter } from '../modules/auth/auth.routes.js'

/**
 * Enrutador principal de la API (/api/v1).
 * @param {ReturnType<import('../container.js').createContainer>} container
 */
export function createApiRouter(container) {
  const router = Router()

  // Endpoint de verificación de salud (Health Check)
  router.get('/health', (_req, res) => {
    return apiResponse.success(res, {
      message: 'Noto API operational',
      data: {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: container.env.NODE_ENV,
      },
    })
  })

  // Módulo de autenticación y usuarios
  router.use(
    '/auth',
    createAuthRouter({
      authController: container.authController,
      rateLimiters: container.rateLimiters,
      authenticate: container.authenticate,
      validate: container.validate,
    })
  )

  return router
}
