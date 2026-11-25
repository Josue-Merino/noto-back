/**
 * Modelo de dominio y funciones de mapeo para la entidad User.
 *
 * La tabla public."user" de Noto guarda: user_id, name, last_name, nickname (obligatorio),
 * credits e image_url. El correo y la fecha de alta vienen del usuario de Supabase Auth, y el
 * segundo nombre y el segundo apellido de su user_metadata (middle_name, second_last_name).
 */

/**
 * Transforma una fila de PostgreSQL (snake_case) al modelo de dominio (camelCase).
 * @param {object | null} row Fila de public."user"
 * @param {object | null} [authUser] Usuario de Supabase Auth (email, created_at, user_metadata)
 * @returns {object | null}
 */
export function fromRow(row, authUser = null) {
  if (!row) return null

  const meta = authUser?.user_metadata || {}
  const middleName = meta.middle_name || null
  const secondLastName = meta.second_last_name || null
  const fullName = [row.name, middleName, row.last_name, secondLastName].filter(Boolean).join(' ')

  return {
    id: row.user_id,
    firstName: row.name,
    middleName,
    lastName: row.last_name,
    secondLastName,
    fullName,
    email: authUser?.email ?? null,
    nickname: row.nickname || null,
    avatarUrl: row.image_url || null,
    credits: row.credits ?? 0,
    createdAt: authUser?.created_at ?? null,
    updatedAt: authUser?.updated_at ?? null,
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
