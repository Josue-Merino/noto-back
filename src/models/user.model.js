/**
 * Modelo de dominio y funciones de mapeo para la entidad User.
 */

/**
 * Transforma una fila de PostgreSQL (snake_case) al modelo de dominio (camelCase).
 * @param {object | null} row
 * @returns {object | null}
 */
export function fromRow(row) {
  if (!row) return null

  const parts = [row.first_name, row.middle_name, row.last_name, row.second_last_name].filter(Boolean)
  const fullName = parts.join(' ')

  return {
    id: row.user_id,
    firstName: row.first_name,
    middleName: row.middle_name || null,
    lastName: row.last_name,
    secondLastName: row.second_last_name || null,
    fullName,
    email: row.email,
    nickname: row.nickname || null,
    avatarUrl: row.avatar_url || null,
    credits: row.credits ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Retorna la representación pública del usuario, excluyendo cualquier dato sensible.
 * @param {object | null} user
 * @returns {object | null}
 */
export function toPublicDTO(user) {
  if (!user) return null

  return {
    id: user.id,
    firstName: user.firstName,
    middleName: user.middleName,
    lastName: user.lastName,
    secondLastName: user.secondLastName,
    fullName: user.fullName,
    email: user.email,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    credits: user.credits,
    createdAt: user.createdAt,
  }
}
