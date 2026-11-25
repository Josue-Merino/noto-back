import os from 'node:os'
import path from 'node:path'

/**
 * Valores por defecto de la generación con IA. Los usa env.js para validar el .env y el
 * contenedor como respaldo cuando recibe un env parcial (p. ej. en pruebas de otros módulos).
 */
export const GENERATION_DEFAULTS = Object.freeze({
  NOTO_AI_URL: 'http://localhost:8000',
  // Una clase larga puede tardar varios minutos en transcribirse y generarse (60 min)
  NOTO_AI_TIMEOUT_MS: 60 * 60 * 1000,
  // Igual al límite del frontend (1.5 GB)
  GENERATION_MAX_FILE_SIZE_MB: 1536,
  // Regla de negocio RN4: el audio no puede durar más de 2 horas
  GENERATION_MAX_DURATION_SEC: 7200,
  // Carpeta donde se guardan los audios mientras se procesan y para reintentar
  GENERATION_TMP_DIR: path.join(os.tmpdir(), 'noto-uploads'),
  // Por encima de este tamaño (o si es video) el back convierte el audio a Opus antes de mandarlo a la IA
  GENERATION_NORMALIZE_ABOVE_MB: 25,
  // Tiempo que se conserva el audio para reintentar o generar más material
  GENERATION_RETENTION_HOURS: 24,
  // Subir 1.5 GB con una conexión lenta tarda más que los 300 s que Node permite por defecto
  HTTP_REQUEST_TIMEOUT_MS: 60 * 60 * 1000,
})
