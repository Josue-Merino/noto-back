import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().positive().default(3000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  SUPABASE_URL: z.string().url('SUPABASE_URL debe ser una URL válida'),
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY es requerida'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY es requerida'),
  EMAIL_REDIRECT_URL: z.string().url().default('http://localhost:5173/login'),
  PASSWORD_RESET_REDIRECT_URL: z.string().url().default('http://localhost:5173/reset-password'),
  LOG_LEVEL: z.string().default('debug'),
})

/**
 * Carga y valida las variables de entorno al iniciar la aplicación.
 * @param {Record<string, string | undefined>} [customEnv] - Variables para testing.
 * @returns {z.infer<typeof envSchema>}
 */
export function loadEnv(customEnv = process.env) {
  // En entorno de testing permitimos fallbacks ficticios si no están configuradas
  const envToValidate = { ...customEnv }
  if (envToValidate.NODE_ENV === 'test') {
    envToValidate.SUPABASE_URL = envToValidate.SUPABASE_URL || 'https://fake-project.supabase.co'
    envToValidate.SUPABASE_ANON_KEY = envToValidate.SUPABASE_ANON_KEY || 'fake-anon-key'
    envToValidate.SUPABASE_SERVICE_ROLE_KEY = envToValidate.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-key'
  }

  const result = envSchema.safeParse(envToValidate)

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n')

    // eslint-disable-next-line no-console
    console.error(`\n❌ Error de configuración: Variables de entorno faltantes o inválidas:\n${formatted}\n`)
    throw new Error(`Variables de entorno inválidas:\n${formatted}`)
  }

  return result.data
}

export const env = loadEnv()
