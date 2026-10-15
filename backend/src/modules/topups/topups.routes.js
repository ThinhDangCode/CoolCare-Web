import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { TopupsRepository } from './topups.repository.js'
import { TopupsService } from './topups.service.js'
import { TopupsController } from './topups.controller.js'

// Mount at /api/admin/topups. STT120 is Admin history viewing, never funding.
export function createTopupsRouter(repository = new TopupsRepository(), options = {}) {
  const router = Router()
  const controller = new TopupsController(new TopupsService(repository, options))
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.listTopups))
  router.get('/:id', asyncHandler(controller.getTopup))
  return router
}
