import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { SettlementRepository } from './settlement.repository.js'
import { SettlementService } from './settlement.service.js'
import { SettlementController } from './settlement.controller.js'

export function createSettlementRouter(repository = new SettlementRepository()) {
  const router = Router()
  const controller = new SettlementController(new SettlementService(repository))
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/withdrawals', asyncHandler(controller.listWithdrawals))
  router.get('/withdrawals/:id', asyncHandler(controller.getWithdrawal))
  return router
}
