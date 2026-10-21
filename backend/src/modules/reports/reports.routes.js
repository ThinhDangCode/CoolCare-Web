import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { ReportsRepository } from './reports.repository.js'
import { ReportsService } from './reports.service.js'
import { ReportsController } from './reports.controller.js'

// Mount at /api/admin/reports. STT121 provides authenticated GET reporting only.
export function createReportsRouter(repository = new ReportsRepository(), options = {}) {
  const router = Router()
  const controller = new ReportsController(new ReportsService(repository, options))
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store')
    next()
  })
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.getReports))
  return router
}
