/**
 * Valores por defecto de la generación con IA. Los usa env.js para validar el .env y el
 * contenedor como respaldo cuando recibe un env parcial (p. ej. en pruebas de otros módulos).
 */
export const GENERATION_DEFAULTS = Object.freeze({
  NOTO_AI_URL: 'http://localhost:8000',
  // Una clase larga puede tardar varios minutos en transcribirse y generarse (30 min)
  NOTO_AI_TIMEOUT_MS: 30 * 60 * 1000,
  // Igual al límite del frontend
  GENERATION_MAX_FILE_SIZE_MB: 500,
})
