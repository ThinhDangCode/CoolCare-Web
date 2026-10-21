import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { TechnicianNotificationsService } from './technician-notifications.service.js'

export function createTechnicianNotificationsRouter(
  service = new TechnicianNotificationsService(),
) {
  const router = Router()
  // Technician partner accounts keep the CUSTOMER role so users can switch
  // between customer and technician modes with the same session. Access to
  // technician features is authorized by the verified profile in the portal
  // repositories, not by a separate JWT role.
  router.use(authenticate, requireRole('CUSTOMER'))

  router.get('/', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json({ data: await service.list(request.auth.userId, request.query) })
  }))

  router.patch('/:id/read', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json({ data: await service.markRead(request.auth.userId, request.params.id) })
  }))

  router.post('/read-all', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json({ data: await service.markAllRead(request.auth.userId) })
  }))

  return router
}
