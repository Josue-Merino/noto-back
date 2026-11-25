import { asyncHandler } from '../../utils/asyncHandler.js'
import { apiResponse } from '../../utils/apiResponse.js'

/**
 * Controlador HTTP para el módulo de autenticación.
 * Capa delegada estrictamente a la recepción de peticiones y emisión de respuestas.
 */
export class AuthController {
  /**
   * @param {object} dependencies
   * @param {import('./auth.service.js').AuthService} dependencies.authService
   */
  constructor({ authService }) {
    this.authService = authService
  }

  register = asyncHandler(async (req, res) => {
    const result = await this.authService.register(req.body)
    return apiResponse.success(res, {
      data: result.user,
      message: result.message,
      status: 201,
    })
  })

  resendVerification = asyncHandler(async (req, res) => {
    const result = await this.authService.resendVerification(req.body)
    return apiResponse.success(res, {
      message: result.message,
      status: 200,
    })
  })

  login = asyncHandler(async (req, res) => {
    const result = await this.authService.login(req.body)
    return apiResponse.success(res, {
      data: result,
      message: 'Inicio de sesión exitoso.',
      status: 200,
    })
  })

  refresh = asyncHandler(async (req, res) => {
    const result = await this.authService.refresh(req.body)
    return apiResponse.success(res, {
      data: result.session,
      status: 200,
    })
  })

  logout = asyncHandler(async (req, res) => {
    const result = await this.authService.logout({ accessToken: req.accessToken })
    return apiResponse.success(res, {
      message: result.message,
      status: 200,
    })
  })

  forgotPassword = asyncHandler(async (req, res) => {
    const result = await this.authService.forgotPassword(req.body)
    return apiResponse.success(res, {
      message: result.message,
      status: 200,
    })
  })

  resetPassword = asyncHandler(async (req, res) => {
    const result = await this.authService.resetPassword({
      user: req.user,
      password: req.body.password,
    })
    return apiResponse.success(res, {
      message: result.message,
      status: 200,
    })
  })

  changePassword = asyncHandler(async (req, res) => {
    const result = await this.authService.changePassword({
      user: req.user,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    })
    return apiResponse.success(res, {
      message: result.message,
      status: 200,
    })
  })

  me = asyncHandler(async (req, res) => {
    const user = await this.authService.me({ userId: req.user.id })
    return apiResponse.success(res, {
      data: user,
      status: 200,
    })
  })

  updateProfile = asyncHandler(async (req, res) => {
    const user = await this.authService.updateProfile({
      userId: req.user.id,
      ...req.body,
    })
    return apiResponse.success(res, {
      message: 'Perfil de usuario actualizado exitosamente.',
      data: user,
      status: 200,
    })
  })
}
