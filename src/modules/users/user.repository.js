import { fromRow } from '../../models/user.model.js'

/**
 * Repositorio de acceso a la tabla "user" en Supabase PostgreSQL.
 * Única capa de la aplicación que se comunica con la persistencia de usuarios.
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
   * Crea un nuevo registro de perfil en public."user".
   * @param {object} userData
   */
  async create({
    userId,
    firstName,
    middleName = null,
    lastName,
    secondLastName = null,
    email,
    nickname = null,
    avatarUrl = null,
    credits = 0,
  }) {
    const rowToInsert = {
      user_id: userId,
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      second_last_name: secondLastName,
      email: email.toLowerCase().trim(),
      nickname,
      avatar_url: avatarUrl,
      credits,
    }

    const { data, error } = await this.db
      .from('user')
      .insert(rowToInsert)
      .select()
      .single()

    if (error) {
      throw error
    }

    return fromRow(data)
  }

  /**
   * Busca un usuario por su UUID.
   * @param {string} userId
   */
  async findById(userId) {
    const { data, error } = await this.db
      .from('user')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      throw error
    }

    return fromRow(data)
  }

  /**
   * Busca un usuario por su correo electrónico.
   * @param {string} email
   */
  async findByEmail(email) {
    const { data, error } = await this.db
      .from('user')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle()

    if (error) {
      throw error
    }

    return fromRow(data)
  }

  /**
   * Actualiza los datos de un usuario.
   * @param {string} userId
   * @param {object} updates
   */
  async update(userId, updates) {
    const rowUpdates = {}
    if (updates.firstName !== undefined) rowUpdates.first_name = updates.firstName
    if (updates.middleName !== undefined) rowUpdates.middle_name = updates.middleName
    if (updates.lastName !== undefined) rowUpdates.last_name = updates.lastName
    if (updates.secondLastName !== undefined) rowUpdates.second_last_name = updates.secondLastName
    if (updates.nickname !== undefined) rowUpdates.nickname = updates.nickname
    if (updates.avatarUrl !== undefined) rowUpdates.avatar_url = updates.avatarUrl
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

    return fromRow(data)
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
