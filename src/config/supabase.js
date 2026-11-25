import { createClient } from '@supabase/supabase-js'
import { env } from './env.js'

/**
 * Crea un cliente Supabase con la service role key para operaciones administrativas y de repositorio.
 * NUNCA debe exponerse al frontend.
 * @param {string} [url]
 * @param {string} [serviceKey]
 */
export function createAdminClient(url = env.SUPABASE_URL, serviceKey = env.SUPABASE_SERVICE_ROLE_KEY) {
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Crea un cliente Supabase nuevo con la anon key para operaciones de autenticación de usuario
 * (login, registro, etc.), evitando compartir estado entre peticiones.
 * @param {string} [url]
 * @param {string} [anonKey]
 */
export function createAnonClient(url = env.SUPABASE_URL, anonKey = env.SUPABASE_ANON_KEY) {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
