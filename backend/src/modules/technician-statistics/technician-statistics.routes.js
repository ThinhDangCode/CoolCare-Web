import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { TechnicianStatisticsRepository } from './technician-statistics.repository.js'
import { TechnicianStatisticsService } from './technician-statistics.service.js'

export function createTechnicianStatisticsRouter(repository = new TechnicianStatisticsRepository(), options = {}) {
  const router = Router()
  const service = new TechnicianStatisticsService(repository, options)
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next() })
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(async (request, response) => {
    const data = await service.getTechnicianStatistics(request.query, request.auth.userId)
    response.json({ success: true, data })
  }))
  return router
}
