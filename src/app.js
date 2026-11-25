import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import compression from 'compression'
import { pinoHttp } from 'pino-http'

import { getCorsOptions } from './config/cors.js'
import { requestId } from './middlewares/requestId.js'
import { notFound } from './middlewares/notFound.js'
import { createApiRouter } from './routes/index.js'

/**
 * Crea y configura la aplicación Express completa con su cadena de middlewares.
 * No inicia el puerto de escucha, permitiendo pruebas de integración puras con supertest.
 * @param {object} options
 * @param {ReturnType<import('./container.js').createContainer>} options.container
 * @param {object} options.env
 * @param {import('pino').Logger} options.logger
 */
export function createApp({ container, env, logger }) {
  const app = express()

  // 1. Identificador único de petición para trazabilidad
  app.use(requestId)

  // 2. Registro estructurado de peticiones HTTP con Pino
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      customLogLevel: (req, res, err) => {
        if (res.statusCode >= 500 || err) return 'error'
        if (res.statusCode >= 400) return 'warn'
        return 'info'
      },
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          query: req.query,
          remoteAddress: req.remoteAddress,
        }),
        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },
    })
  )

  // 3. Cabeceras de seguridad HTTP
  app.use(helmet())

  // 4. Cross-Origin Resource Sharing con lista blanca
  app.use(cors(getCorsOptions(env)))

  // 5. Compresión gzip/brotli
  app.use(compression())

  // 6. Parseo de JSON en el cuerpo con límite para avatares y peticiones
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true, limit: '10mb' }))

  // 7. Limitador de tasa global
  app.use(container.rateLimiters.general)

  // 8. Rutas de la versión 1 de la API
  app.use('/api/v1', createApiRouter(container))

  // 9. Manejador para rutas inexistentes (404 uniforme)
  app.use(notFound)

  // 10. Manejador global centralizado de errores
  app.use(container.errorHandler)

  return app
}
