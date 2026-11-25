import { fromRow } from '../../models/user.model.js'

/**
 * Repositorio de acceso a la tabla "user" en Supabase PostgreSQL.
 * Única capa de la aplicación que se comunica con la persistencia de usuarios.
 *
 * Columnas: user_id, name, last_name, nickname (obligatorio), credits, image_url.
 * Los métodos reciben opcionalmente el usuario de Supabase Auth para completar el perfil
 * (correo, fecha de alta y segundos nombres de user_metadata).
 */
export class UserRepository {
  /**
   * @param {object} dependencies
   * @param {import('@supabase/supabase-js').SupabaseClient} dependencies.supabaseAdmin
   */
  constructor({ supabaseAdmin }) {
    this.db = supabaseAdmin
  }

  /**
   * Crea (o completa, si el trigger de alta de Supabase Auth ya la creó) la fila de perfil en
   * public."user". `credits` e `image_url` solo se escriben si se pasan, para no pisar lo que
   * haya puesto el trigger (en una fila nueva toman su valor por defecto).
   * @param {object} userData
   * @param {object | null} [authUser]
   */
  async create({ userId, firstName, lastName, nickname = null, avatarUrl, credits }, authUser = null) {
    const rowToInsert = {
      user_id: userId,
      name: firstName,
      last_name: lastName,
      nickname: nickname || firstName,
    }
    if (avatarUrl !== undefined) rowToInsert.image_url = avatarUrl
    if (credits !== undefined) rowToInsert.credits = credits

    const { data, error } = await this.db
      .from('user')
      .upsert(rowToInsert, { onConflict: 'user_id' })
      .select()
      .single()

    if (error) {
      throw error
    }

    return fromRow(data, authUser)
  }

  /**
   * Busca un usuario por su UUID.
   * @param {string} userId
   * @param {object | null} [authUser]
   */
  async findById(userId, authUser = null) {
    const { data, error } = await this.db
      .from('user')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      throw error
    }

    return fromRow(data, authUser)
  }

  /**
   * Actualiza los datos de un usuario.
   * @param {string} userId
   * @param {object} updates
   * @param {object | null} [authUser]
   */
  async update(userId, updates, authUser = null) {
    const rowUpdates = {}
    if (updates.firstName !== undefined) rowUpdates.name = updates.firstName
    if (updates.lastName !== undefined) rowUpdates.last_name = updates.lastName
    if (updates.nickname !== undefined) rowUpdates.nickname = updates.nickname
    if (updates.avatarUrl !== undefined) rowUpdates.image_url = updates.avatarUrl
    if (updates.credits !== undefined) rowUpdates.credits = updates.credits

    const { data, error } = await this.db
      .from('user')
      .update(rowUpdates)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) {
      throw error
    }

    return fromRow(data, authUser)
  }

  /**
   * Elimina un registro de usuario.
   * @param {string} userId
   */
  async delete(userId) {
    const { error } = await this.db
      .from('user')
      .delete()
      .eq('user_id', userId)

    if (error) {
      throw error
    }

    return true
  }
}
