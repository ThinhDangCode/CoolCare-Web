import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { CustomerStatisticsRepository } from './customer-statistics.repository.js'
import { CustomerStatisticsService } from './customer-statistics.service.js'

export function createCustomerStatisticsRouter(repository = new CustomerStatisticsRepository(), options = {}) {
  const router = Router()
  const service = new CustomerStatisticsService(repository, options)
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next() })
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(async (request, response) => {
    const data = await service.getCustomerStatistics(request.query, request.auth.userId)
    response.json({ success: true, data })
  }))
  return router
}
