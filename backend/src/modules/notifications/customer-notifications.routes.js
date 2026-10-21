import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { CustomerNotificationsService } from './customer-notifications.service.js'

export function createCustomerNotificationsRouter(service = new CustomerNotificationsService()) {
  const router = Router()
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
