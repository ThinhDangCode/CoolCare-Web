import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { CustomerAcUnitService } from './ac-unit.service.js'

// Mounted at /api/customer/ac-units (STT: View AC Service History).
export function createCustomerAcUnitRouter(service = new CustomerAcUnitService()) {
  const router = Router()
  router.use(authenticate, requireRole('CUSTOMER'))

  router.get('/', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'private, no-store')
      .json({ data: await service.listUnits(request.auth.userId) })
  }))

  router.get('/service-history', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'private, no-store')
      .json({ data: await service.getHistory(request.auth.userId, request.query) })
  }))

  return router
}
