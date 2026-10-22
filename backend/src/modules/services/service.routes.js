import { Router } from 'express'
import { asyncHandler } from '../../utils.js'
import { listActiveServices, findActiveServiceById } from './service.repository.js'

export function createServiceRouter() {
  const router = Router()

  router.get('/', asyncHandler(async (_request, response) => {
    const services = await listActiveServices()
    response.json({ data: services })
  }))

  router.get('/:id', asyncHandler(async (request, response) => {
    const service = await findActiveServiceById(request.params.id)
    if (!service) {
      return response.status(404).json({ error: { message: 'Service not found' } })
    }
    response.json({ data: service })
  }))

  return router
}
