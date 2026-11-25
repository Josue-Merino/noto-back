import { ConflictError, UnauthorizedError, NotFoundError } from '../../errors/httpErrors.js'
import { mapSupabaseAuthError } from './auth.errors.js'
import { toPublicDTO } from '../../models/user.model.js'

/**
 * Servicio de lógica de negocio para autenticación y usuarios.
 */
export class AuthService {
  /**
   * @param {object} dependencies
   * @param {import('../users/user.repository.js').UserRepository} dependencies.userRepository
   * @param {() => import('@supabase/supabase-js').SupabaseClient} dependencies.createAnonClient
   * @param {import('@supabase/supabase-js').SupabaseClient} dependencies.adminClient
   * @param {object} dependencies.env
   * @param {object} dependencies.logger
   */
  constructor({ userRepository, createAnonClient, adminClient, env, logger }) {
    this.userRepository = userRepository
    this.createAnonClient = createAnonClient
    this.adminClient = adminClient
    this.env = env
    this.logger = logger
  }

  /**
   * Registra un nuevo usuario en Supabase Auth y crea su perfil en public."user".
   * Si la creación del perfil falla, revierte eliminando el usuario de Auth (consistencia).
   */
  async register({ firstName, middleName, lastName, secondLastName, email, password }) {
    const normalizedEmail = email.toLowerCase().trim()

    // 1. Registrar en Supabase Auth. El trigger de alta del proyecto crea public."user" desde
    //    user_metadata y exige name, last_name y nickname. El segundo nombre y el segundo
    //    apellido también van en user_metadata porque public."user" no tiene columnas para ellos.
    const anonClient = this.createAnonClient()
    const { data: authData, error: authError } = await anonClient.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: this.env.EMAIL_REDIRECT_URL,
        data: {
          name: firstName,
          first_name: firstName,
          middle_name: middleName || null,
          last_name: lastName,
          second_last_name: secondLastName || null,
          nickname: firstName,
        },
      },
    })

    if (authError) {
      this.logger.warn({ err: authError, email: normalizedEmail }, 'Error en Supabase Auth signUp')
      throw mapSupabaseAuthError(authError)
    }

    // Con la confirmación de correo activa, Supabase no devuelve error para un correo ya
    // registrado: responde un usuario sin identidades.
    const authUser = authData.user
    if (!authUser?.id || (Array.isArray(authUser.identities) && authUser.identities.length === 0)) {
      throw new ConflictError(
        'El correo electrónico ya se encuentra registrado.',
        'EMAIL_ALREADY_REGISTERED'
      )
    }
    const userId = authUser.id

    // 2. Crear el perfil en public."user"
    let profile
    try {
      profile = await this.userRepository.create({ userId, firstName, lastName }, authUser)
    } catch (dbError) {
      this.logger.error(
        { err: dbError, userId },
        'Fallo al crear perfil en public."user". Revirtiendo usuario en Auth...'
      )
      // Rollback para consistencia
      await this.adminClient.auth.admin.deleteUser(userId).catch((delErr) => {
        this.logger.error({ delErr, userId }, 'Error al revertir usuario en Auth tras fallo de BD')
      })
      throw dbError
    }

    this.logger.info({ userId, email: normalizedEmail }, 'Usuario registrado exitosamente')

    return {
      user: toPublicDTO(profile),
      message: 'Cuenta creada con éxito. Por favor verifica tu correo electrónico para activarla.',
    }
  }

  /**
   * Reenvía el correo de verificación de cuenta.
   */
  async resendVerification({ email }) {
    const anonClient = this.createAnonClient()
    const { error } = await anonClient.auth.resend({
      type: 'signup',
      email: email.toLowerCase().trim(),
      options: {
        emailRedirectTo: this.env.EMAIL_REDIRECT_URL,
      },
    })

    if (error) {
      this.logger.warn({ err: error, email }, 'Error al reenviar verificación')
      // No revelar si el correo existe o no al cliente
    }

    return {
      message: 'Si la cuenta existe y requiere activación, se ha enviado un nuevo enlace de verificación.',
    }
  }

  /**
   * Inicia sesión con correo y contraseña.
   */
  async login({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim()
    const anonClient = this.createAnonClient()

    const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })

    if (authError) {
      this.logger.warn({ err: authError, email: normalizedEmail }, 'Intento de login fallido')
      throw mapSupabaseAuthError(authError)
    }

    const userId = authData.user.id

    // Obtener perfil de la base de datos
    let profile = await this.userRepository.findById(userId, authData.user)
    if (!profile) {
      // Fallback por si el usuario existía en Auth pero aún no tenía fila de perfil
      const meta = authData.user.user_metadata || {}
      profile = await this.userRepository.create(
        {
          userId,
          firstName: meta.first_name || meta.name || 'Usuario',
          lastName: meta.last_name || 'Noto',
        },
        authData.user
      )
    }

    this.logger.info({ userId, email: normalizedEmail }, 'Inicio de sesión exitoso')

    return {
      user: toPublicDTO(profile),
      session: {
        accessToken: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        expiresAt: authData.session.expires_at,
      },
    }
  }

  /**
   * Refresca la sesión activa utilizando el refresh token.
   */
  async refresh({ refreshToken }) {
    const anonClient = this.createAnonClient()
    const { data, error } = await anonClient.auth.refreshSession({
      refresh_token: refreshToken,
    })

    if (error || !data.session) {
      this.logger.warn({ err: error }, 'Fallo al refrescar token')
      throw new UnauthorizedError('Token de sesión inválido o expirado.', 'UNAUTHORIZED')
    }

    return {
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    }
  }

  /**
   * Cierra la sesión activa invalidando el token.
   */
  async logout({ accessToken }) {
    if (accessToken) {
      try {
        await this.adminClient.auth.admin.signOut(accessToken)
      } catch (err) {
        this.logger.warn({ err }, 'Error menor al invalidar sesión con admin')
      }
    }
    return {
      message: 'Sesión cerrada con éxito.',
    }
  }

  /**
   * Solicita el restablecimiento de contraseña para un correo.
   * Mensaje genérico para evitar enumeración de usuarios.
   */
  async forgotPassword({ email }) {
    const normalizedEmail = email.toLowerCase().trim()
    const anonClient = this.createAnonClient()

    await anonClient.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: this.env.PASSWORD_RESET_REDIRECT_URL,
    })

    return {
      message: 'Si existe una cuenta asociada a este correo, recibirás un enlace de recuperación.',
    }
  }

  /**
   * Restablece la contraseña del usuario autenticado (mediante el token de recuperación).
   */
  async resetPassword({ user, password }) {
    const { error } = await this.adminClient.auth.admin.updateUserById(user.id, {
      password,
    })

    if (error) {
      this.logger.error({ err: error, userId: user.id }, 'Error al resetear contraseña')
      throw mapSupabaseAuthError(error)
    }

    this.logger.info({ userId: user.id }, 'Contraseña restablecida exitosamente')

    return {
      message: 'Contraseña actualizada con éxito.',
    }
  }

  /**
   * Cambia la contraseña actual por una nueva, verificando la contraseña vigente.
   */
  async changePassword({ user, currentPassword, newPassword }) {
    const anonClient = this.createAnonClient()

    // 1. Reautenticar con la contraseña actual para verificar validez
    const { error: verifyError } = await anonClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })

    if (verifyError) {
      throw new UnauthorizedError('La contraseña actual es incorrecta.', 'INVALID_CREDENTIALS')
    }

    // 2. Actualizar la contraseña
    const { error: updateError } = await this.adminClient.auth.admin.updateUserById(user.id, {
      password: newPassword,
    })

    if (updateError) {
      throw mapSupabaseAuthError(updateError)
    }

    this.logger.info({ userId: user.id }, 'Contraseña cambiada por el usuario')

    return {
      message: 'Contraseña actualizada con éxito.',
    }
  }

  /**
   * Devuelve el perfil completo del usuario autenticado.
   */
  async me({ user }) {
    const profile = await this.userRepository.findById(user.id, user)
    if (!profile) {
      throw new NotFoundError('Perfil de usuario no encontrado.', 'USER_NOT_FOUND')
    }
    return toPublicDTO(profile)
  }

  /**
   * Actualiza los datos de perfil del usuario. El segundo nombre y el segundo apellido se
   * guardan en user_metadata de Supabase Auth.
   */
  async updateProfile({ user, firstName, middleName, lastName, secondLastName, avatarUrl }) {
    const userId = user.id
    const existing = await this.userRepository.findById(userId, user)
    if (!existing) {
      throw new NotFoundError('Perfil de usuario no encontrado.', 'USER_NOT_FOUND')
    }

    let authUser = user
    if (middleName !== undefined || secondLastName !== undefined) {
      const meta = { ...(user.user_metadata || {}) }
      if (middleName !== undefined) meta.middle_name = middleName || null
      if (secondLastName !== undefined) meta.second_last_name = secondLastName || null
      const { data, error } = await this.adminClient.auth.admin.updateUserById(userId, {
        user_metadata: meta,
      })
      if (error) {
        this.logger.error({ err: error, userId }, 'Error al actualizar user_metadata')
        throw mapSupabaseAuthError(error)
      }
      authUser = data?.user || { ...user, user_metadata: meta }
    }

    const updated = await this.userRepository.update(
      userId,
      { firstName, lastName, avatarUrl },
      authUser
    )

    this.logger.info({ userId }, 'Perfil de usuario actualizado con éxito')
    return toPublicDTO(updated)
  }
}
