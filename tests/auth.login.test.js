import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createContainer } from '../src/container.js'
import { createLogger } from '../src/config/logger.js'
import { createFakeSupabase } from './helpers/fakeSupabase.js'

describe('Auth Module - Login y Sesión (/api/v1/auth/login, /me)', () => {
  let app
  let fakeSupabase

  beforeEach(() => {
    fakeSupabase = createFakeSupabase()
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
    }

    const testLogger = createLogger(testEnv)

    const container = createContainer({
      env: testEnv,
      supabaseAdmin: fakeSupabase,
      createAnonClient: () => fakeSupabase,
      logger: testLogger,
    })

    app = createApp({ container, env: testEnv, logger: testLogger })
  })

  it('debe rechazar login si el correo no está verificado (403)', async () => {
    // 1. Registrar usuario sin confirmar
    await request(app).post('/api/v1/auth/register').send({
      firstName: 'Marcos',
      lastName: 'Ruiz',
      email: 'marcos@noto.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    })

    // 2. Intentar login
    const response = await request(app).post('/api/v1/auth/login').send({
      email: 'marcos@noto.com',
      password: 'Password123',
    })

    expect(response.status).toBe(403)
    expect(response.body.success).toBe(false)
    expect(response.body.error.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('debe rechazar login con credenciales incorrectas (401)', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({
      email: 'noexiste@noto.com',
      password: 'PasswordErronea123',
    })

    expect(response.status).toBe(401)
    expect(response.body.success).toBe(false)
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('debe iniciar sesión exitosamente con credenciales y correo verificado (200)', async () => {
    // Registrar usuario y marcar confirmado en fakeSupabase
    await request(app).post('/api/v1/auth/register').send({
      firstName: 'Lucia',
      lastName: 'Fernandez',
      email: 'lucia@noto.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    })

    // Confirmar en el fake
    for (const u of fakeSupabase._internal.usersAuth.values()) {
      if (u.email === 'lucia@noto.com') {
        u.email_confirmed_at = new Date().toISOString()
      }
    }

    // Iniciar sesión
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: 'lucia@noto.com',
      password: 'Password123',
    })

    expect(loginRes.status).toBe(200)
    expect(loginRes.body.success).toBe(true)
    expect(loginRes.body.data.user.email).toBe('lucia@noto.com')
    expect(loginRes.body.data.session).toHaveProperty('accessToken')

    const token = loginRes.body.data.session.accessToken

    // Consultar /me con el token
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(meRes.status).toBe(200)
    expect(meRes.body.data.firstName).toBe('Lucia')
  })

  it('debe rechazar acceso a /me si no se envía token (401)', async () => {
    const response = await request(app).get('/api/v1/auth/me')
    expect(response.status).toBe(401)
    expect(response.body.success).toBe(false)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('debe responder 404 con formato uniforme en rutas inexistentes', async () => {
    const response = await request(app).get('/api/v1/ruta-que-no-existe')
    expect(response.status).toBe(404)
    expect(response.body.success).toBe(false)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })

  it('debe responder 200 en endpoint de health check', async () => {
    const response = await request(app).get('/api/v1/health')
    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.message).toBe('Noto API operational')
  })
})
