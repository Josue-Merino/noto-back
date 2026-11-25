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

  // POST /generation/create → 202: el material se genera en segundo plano
  create = asyncHandler(async (req, res) => {
    const job = await this.generationService.create({
      userId: req.user.id,
      accessToken: req.accessToken,
      file: req.file,
      ...req.body,
    })
    return apiResponse.success(res, {
      data: job,
      message: 'Recibimos tu audio. Estamos generando el material de estudio.',
      status: 202,
    })
  })

  // GET /generation
  list = asyncHandler(async (req, res) => {
    const jobs = await this.generationService.list(req.user.id)
    return apiResponse.success(res, { data: jobs })
  })

  // GET /generation/:id
  get = asyncHandler(async (req, res) => {
    const job = await this.generationService.get(req.user.id, req.params.id)
    return apiResponse.success(res, { data: job })
  })

  // POST /generation/:id/cancel
  cancel = asyncHandler(async (req, res) => {
    const job = await this.generationService.cancel(req.user.id, req.params.id)
    return apiResponse.success(res, { data: job, message: 'Generación cancelada.' })
  })

  // POST /generation/:id/retry
  retry = asyncHandler(async (req, res) => {
    const job = await this.generationService.retry(req.user.id, req.params.id, req.accessToken)
    return apiResponse.success(res, { data: job, message: 'Reintentando la generación.', status: 202 })
  })

  // POST /generation/:id/materials
  addMaterials = asyncHandler(async (req, res) => {
    const job = await this.generationService.addMaterials(
      req.user.id,
      req.params.id,
      req.body.materials,
      req.accessToken
    )
    return apiResponse.success(res, { data: job, message: 'Generando el material adicional.', status: 202 })
  })

  // GET /generation/:id/audio → archivo (sendFile atiende los rangos que pide el reproductor)
  audio = asyncHandler(async (req, res) => {
    const audio = await this.generationService.getAudio(req.user.id, req.params.id)
    await new Promise((resolve, reject) => {
      res.sendFile(
        audio.path,
        { headers: { 'Content-Type': audio.mimeType, 'Cache-Control': 'private, no-store' } },
        (err) => (err && !res.headersSent ? reject(err) : resolve())
      )
    })
  })
}
