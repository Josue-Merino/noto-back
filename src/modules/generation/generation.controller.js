import { asyncHandler } from '../../utils/asyncHandler.js'
import { apiResponse } from '../../utils/apiResponse.js'

/**
 * Controlador HTTP para la generación de material de estudio.
 */
export class GenerationController {
  /**
   * @param {object} dependencies
   * @param {import('./generation.service.js').GenerationService} dependencies.generationService
   */
  constructor({ generationService }) {
    this.generationService = generationService
  }

  create = asyncHandler(async (req, res) => {
    const material = await this.generationService.create({
      userId: req.user.id,
      accessToken: req.accessToken,
      file: req.file,
      ...req.body,
    })
    return apiResponse.success(res, {
      data: material,
      message: 'Material de estudio generado exitosamente.',
      status: 201,
    })
  })
}
