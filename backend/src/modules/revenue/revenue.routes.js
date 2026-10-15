import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { RevenueRepository } from './revenue.repository.js'
import { RevenueService } from './revenue.service.js'
import { RevenueController } from './revenue.controller.js'

// Mount at /api/admin/revenue. STT118 is reporting only; no financial mutations.
export function createRevenueRouter(repository = new RevenueRepository(), options = {}) {
  const router = Router()
  const controller = new RevenueController(new RevenueService(repository, options))
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.getRevenueReport))
  return router
}
