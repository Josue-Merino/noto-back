import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createContainer } from '../src/container.js'
import { createLogger } from '../src/config/logger.js'
import { createFakeSupabase } from './helpers/fakeSupabase.js'

describe('Auth Module - Registro (/api/v1/auth/register)', () => {
  let app

  beforeEach(() => {
    const fakeSupabase = createFakeSupabase()
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

  it('debe registrar un usuario exitosamente (201)', async () => {
    const payload = {
      firstName: 'Alejandro',
      middleName: 'Mateo',
      lastName: 'Pérez',
      secondLastName: 'Gómez',
      email: 'alejandro@noto.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    }

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(payload)

    expect(response.status).toBe(201)
    expect(response.body.success).toBe(true)
    expect(response.body.data).toMatchObject({
      firstName: 'Alejandro',
      middleName: 'Mateo',
      lastName: 'Pérez',
      secondLastName: 'Gómez',
      email: 'alejandro@noto.com',
    })
    expect(response.body.message).toContain('verifica tu correo')
  })

  it('debe rechazar registro con datos inválidos (400) y listar detalles por campo', async () => {
    const invalidPayload = {
      firstName: '',
      lastName: '',
      email: 'correo-invalido',
      password: '123', // menos de 8 chars y sin letras
      confirmPassword: 'abc',
    }

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(invalidPayload)

    expect(response.status).toBe(400)
    expect(response.body.success).toBe(false)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(Array.isArray(response.body.error.details)).toBe(true)
    expect(response.body.error.details.length).toBeGreaterThan(0)
  })

  it('debe rechazar registro si el correo ya está registrado (409)', async () => {
    const payload = {
      firstName: 'Carlos',
      lastName: 'Santana',
      email: 'carlos@noto.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    }

    // Primer registro
    const firstRes = await request(app).post('/api/v1/auth/register').send(payload)
    expect(firstRes.status).toBe(201)

    // Intento con correo duplicado
    const secondRes = await request(app).post('/api/v1/auth/register').send(payload)
    expect(secondRes.status).toBe(409)
    expect(secondRes.body.success).toBe(false)
    expect(secondRes.body.error.code).toBe('EMAIL_ALREADY_REGISTERED')
  })
})
