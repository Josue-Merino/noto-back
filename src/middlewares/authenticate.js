import { UnauthorizedError } from '../errors/httpErrors.js'

/**
 * Fábrica del middleware de autenticación con Supabase JWT.
 * @param {object} dependencies
 * @param {import('@supabase/supabase-js').SupabaseClient} dependencies.supabaseAdmin
 */
export function createAuthenticateMiddleware({ supabaseAdmin }) {
  return async function authenticate(req, _res, next) {
    try {
      const authHeader = req.headers.authorization

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedError(
          'Token de autorización no proporcionado o formato inválido.',
          'UNAUTHORIZED'
        )
      }

      const token = authHeader.substring(7).trim()
      if (!token) {
        throw new UnauthorizedError(
          'Token de autorización vacío.',
          'UNAUTHORIZED'
        )
      }

      // Validar el token con el cliente de Supabase
      const { data, error } = await supabaseAdmin.auth.getUser(token)

      if (error || !data.user) {
        throw new UnauthorizedError(
          'Sesión inválida, expirada o no autorizada.',
          'UNAUTHORIZED'
        )
      }

      req.user = data.user
      req.accessToken = token
      next()
    } catch (err) {
      next(err)
    }
  }
}
