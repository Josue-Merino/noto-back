import { Router } from 'express'
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  refreshTokenSchema,
  resendVerificationSchema,
  updateProfileSchema,
} from './auth.schemas.js'

/**
 * Fábrica de rutas del módulo de autenticación.
 * @param {object} dependencies
 * @param {import('./auth.controller.js').AuthController} dependencies.authController
 * @param {object} dependencies.rateLimiters
 * @param {import('express').RequestHandler} dependencies.authenticate
 * @param {(schema: any) => import('express').RequestHandler} dependencies.validate
 */
export function createAuthRouter({ authController, rateLimiters, authenticate, validate }) {
  const router = Router()

  // Rutas públicas (con limitador estricto para proteger endpoints sensibles)
  router.post(
    '/register',
    rateLimiters.auth,
    validate(registerSchema),
    authController.register
  )

  router.post(
    '/resend-verification',
    rateLimiters.auth,
    validate(resendVerificationSchema),
    authController.resendVerification
  )

  router.post(
    '/login',
    rateLimiters.auth,
    validate(loginSchema),
    authController.login
  )

  router.post(
    '/refresh',
    validate(refreshTokenSchema),
    authController.refresh
  )

  router.post(
    '/forgot-password',
    rateLimiters.auth,
    validate(forgotPasswordSchema),
    authController.forgotPassword
  )

  // Rutas autenticadas (requieren JWT de Supabase)
  router.post(
    '/logout',
    authenticate,
    authController.logout
  )

  router.post(
    '/reset-password',
    authenticate,
    validate(resetPasswordSchema),
    authController.resetPassword
  )

  router.post(
    '/change-password',
    authenticate,
    validate(changePasswordSchema),
    authController.changePassword
  )

  router.get(
    '/me',
    authenticate,
    authController.me
  )

  router.patch(
    '/profile',
    authenticate,
    validate(updateProfileSchema),
    authController.updateProfile
  )

  return router
}
