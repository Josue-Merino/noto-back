import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { createAdminClient, createAnonClient } from './config/supabase.js'
import { createContainer } from './container.js'
import { createApp } from './app.js'

// Inicialización de clientes Supabase
const supabaseAdmin = createAdminClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// Composición del contenedor de dependencias
const container = createContainer({
  env,
  supabaseAdmin,
  createAnonClient: () => createAnonClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY),
  logger,
})

// Creación de la aplicación Express
const app = createApp({ container, env, logger })

// Inicio del servidor HTTP
const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    `🚀 Noto Backend API escuchando en el puerto ${env.PORT}`
  )
})

// Subir un archivo de 1.5 GB con una conexión lenta tarda más que los 300 s que Node permite por defecto
server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS

// Barrido de retención: borra los audios de generación vencidos (cada 30 minutos)
const retentionTimer = setInterval(() => {
  container.generationService.purgeExpiredAudio().catch((err) => {
    logger.error({ err }, 'Error al borrar audios vencidos')
  })
}, 30 * 60 * 1000)
retentionTimer.unref()

// Cierre controlado y ordenado (Graceful Shutdown)
function handleShutdown(signal) {
  logger.info({ signal }, `Señal ${signal} recibida. Cerrando servidor ordenadamente...`)

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error durante el cierre del servidor HTTP')
      process.exit(1)
    }
    logger.info('Servidor HTTP cerrado exitosamente.')
    process.exit(0)
  })

  // Forzar apagado si no responde en 10 segundos
  setTimeout(() => {
    logger.error('Tiempo de espera agotado para el apagado ordenado. Forzando salida.')
    process.exit(1)
  }, 10000).unref()
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'))
process.on('SIGINT', () => handleShutdown('SIGINT'))

// Captura de promesas rechazadas y excepciones no capturadas
process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled Rejection detectada')
})

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught Exception detectada. Terminando proceso...')
  process.exit(1)
})
