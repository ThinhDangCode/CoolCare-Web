import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { WithdrawalsRepository } from './withdrawals.repository.js'
import { WithdrawalsService } from './withdrawals.service.js'
import { WithdrawalsController } from './withdrawals.controller.js'

// Mount at /api/admin/withdrawals. Admin viewing only, never payout management.
export function createWithdrawalsRouter(repository = new WithdrawalsRepository(), options = {}) {
  const router = Router()
  const controller = new WithdrawalsController(new WithdrawalsService(repository, options))
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.listWithdrawals))
  router.get('/:id', asyncHandler(controller.getWithdrawal))
  return router
}
