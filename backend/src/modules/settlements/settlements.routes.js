import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { SettlementsRepository } from './settlements.repository.js'
import { SettlementsService } from './settlements.service.js'
import { SettlementsController } from './settlements.controller.js'

// Viewing an existing period never creates, closes or pays a settlement.
export function createSettlementsRouter(repository = new SettlementsRepository(), options = {}) {
  const router = Router()
  const controller = new SettlementsController(new SettlementsService(repository, options))
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next() })
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.listSettlements))
  router.get('/:id', asyncHandler(controller.getSettlement))
  return router
}
