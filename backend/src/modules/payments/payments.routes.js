import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { PaymentsRepository } from './payments.repository.js'
import { PaymentsService } from './payments.service.js'
import { PaymentsController } from './payments.controller.js'

// Mount at /api/admin/payments. Read-only list/detail (STT 116/117).
export function createPaymentsRouter(repository = new PaymentsRepository(), options = {}) {
  const router = Router()
  const controller = new PaymentsController(new PaymentsService(repository, options))
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.listPayments))
  router.get('/:id', asyncHandler(controller.getPayment))
  return router
}
