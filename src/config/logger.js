import pino from 'pino'
import { env } from './env.js'

export function createLogger(config = env) {
  const isDevelopment = config.NODE_ENV === 'development'

  return pino({
    level: config.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
    // Redacción estricta de seguridad: nunca loguear contraseñas, tokens ni credenciales
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-access-token"]',
        '*.password',
        '*.confirmPassword',
        '*.currentPassword',
        '*.newPassword',
        '*.refreshToken',
        '*.accessToken',
        '*.service_role',
        '*.serviceRoleKey',
        'body.password',
        'body.confirmPassword',
      ],
      censor: '[REDACTADO]',
    },
    transport:
      isDevelopment
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  })
}

export const logger = createLogger()
