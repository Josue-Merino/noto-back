/**
 * Repositorio de trabajos de generación **en memoria**.
 *
 * Es el puerto de persistencia del módulo: el servicio solo usa estos métodos, así que cambiarlo por
 * una base de datos es implementar la misma interfaz. Mientras tanto, los trabajos se pierden al
 * reiniciar el backend (los audios del disco los limpia el barrido de retención).
 *
 * Guarda y devuelve copias para que nadie mute el estado interno por accidente.
 */
export class InMemoryGenerationJobRepository {
  /** @type {Map<string, object>} */
  #jobs = new Map()

  /**
   * @param {object} job
   * @returns {Promise<object>}
   */
  async create(job) {
    this.#jobs.set(job.id, structuredClone(job))
    return structuredClone(job)
  }

  /**
   * @param {string} id
   * @returns {Promise<object | null>}
   */
  async findById(id) {
    const job = this.#jobs.get(id)
    return job ? structuredClone(job) : null
  }

  /**
   * Trabajos de un usuario, del más reciente al más antiguo.
   * @param {string} userId
   * @returns {Promise<object[]>}
   */
  async listByUser(userId) {
    return [...this.#jobs.values()]
      .filter((job) => job.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((job) => structuredClone(job))
  }

  /**
   * Aplica un cambio parcial (los objetos anidados se reemplazan completos).
   * @param {string} id
   * @param {object} patch
   * @returns {Promise<object | null>}
   */
  async update(id, patch) {
    const current = this.#jobs.get(id)
    if (!current) return null
    const updated = { ...current, ...structuredClone(patch) }
    this.#jobs.set(id, updated)
    return structuredClone(updated)
  }

  /**
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    return this.#jobs.delete(id)
  }

  /**
   * Todos los trabajos (para el barrido de retención).
   * @returns {Promise<object[]>}
   */
  async listAll() {
    return [...this.#jobs.values()].map((job) => structuredClone(job))
  }
}
