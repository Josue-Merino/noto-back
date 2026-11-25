import {
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  TooManyRequestsError,
  BadRequestError,
  InternalServerError,
} from '../../errors/httpErrors.js'

/**
 * Traduce errores de Supabase Auth a errores de dominio de la aplicación (AppError).
 * Evita exponer detalles internos o mensajes técnicos en inglés al cliente.
 * @param {any} error
 * @returns {import('../../errors/AppError.js').AppError}
 */
export function mapSupabaseAuthError(error) {
  if (!error) return new InternalServerError('Error de autenticación desconocido')

  const msg = (error.message || '').toLowerCase()
  const status = error.status || error.statusCode

  // Correo inválido
  if (
    msg.includes('email address') && msg.includes('invalid') ||
    error.code === 'email_address_invalid'
  ) {
    return new BadRequestError(
      'El correo electrónico no es válido o no pertenece a un dominio de correo real.',
      'INVALID_EMAIL_ADDRESS',
      { email: 'Ingresa un correo electrónico válido (ej. @gmail.com o @outlook.com).' }
    )
  }

  // Correo no confirmado
  if (msg.includes('email not confirmed') || error.code === 'email_not_confirmed') {
    return new ForbiddenError(
      'Debes verificar tu correo electrónico antes de iniciar sesión.',
      'EMAIL_NOT_VERIFIED'
    )
  }

  // Credenciales incorrectas
  if (
    msg.includes('invalid login credentials') ||
    msg.includes('invalid credentials') ||
    status === 400 && msg.includes('credentials')
  ) {
    return new UnauthorizedError('Credenciales incorrectas.', 'INVALID_CREDENTIALS')
  }

  // Usuario ya registrado
  if (
    msg.includes('user already registered') ||
    msg.includes('already exists') ||
    error.code === 'user_already_exists'
  ) {
    return new ConflictError(
      'El correo electrónico ya se encuentra registrado.',
      'EMAIL_ALREADY_REGISTERED'
    )
  }

  // Límite de envíos alcanzado
  if (msg.includes('rate limit') || msg.includes('too many requests') || status === 429) {
    return new TooManyRequestsError(
      'Has superado el límite de intentos. Por favor espera unos minutos.',
      'RATE_LIMITED'
    )
  }

  // Token inválido o expirado
  if (
    msg.includes('token has expired') ||
    msg.includes('invalid token') ||
    msg.includes('token is invalid') ||
    msg.includes('jwt expired')
  ) {
    return new UnauthorizedError(
      'El enlace o token ha expirado o no es válido.',
      'TOKEN_EXPIRED'
    )
  }

  // Errores de solicitud malformada de Supabase
  if (status === 400) {
    return new BadRequestError(
      'Solicitud de autenticación no válida.',
      'BAD_REQUEST'
    )
  }

  return new InternalServerError(
    'Ocurrió un error inesperado durante la autenticación.',
    'AUTH_ERROR'
  )
}
