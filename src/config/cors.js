import { env } from './env.js'

export function getCorsOptions(config = env) {
  const allowedOrigins = config.CORS_ORIGINS
    ? config.CORS_ORIGINS.split(',').map((origin) => origin.trim())
    : [config.FRONTEND_URL]

  return {
    origin: (origin, callback) => {
      // Permitir peticiones sin origin (como herramientas móviles o curl en desarrollo)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error(`Origen ${origin} no permitido por política CORS`))
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400, // 24 horas en caché preflight
  }
}
