import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { PaymentsRepository } from './payments.repository.js'
import { PaymentsService } from './payments.service.js'
import { PaymentsController } from './payments.controller.js'
import { PaymentsExportRepository } from './payments.export.repository.js'
import { PaymentsExportService } from './payments.export.service.js'

// Mount at /api/admin/payments. Read-only list/detail/export (STT 116/117/115).
export function createPaymentsRouter(repository = new PaymentsRepository(), options = {}) {
  const router = Router()
  const controller = new PaymentsController(
    new PaymentsService(repository, options),
    new PaymentsExportService(options.exportRepository ?? new PaymentsExportRepository(), options)
  )
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.listPayments))
  router.get('/export', asyncHandler(controller.exportRevenue))
  router.get('/:id', asyncHandler(controller.getPayment))
  return router
}
