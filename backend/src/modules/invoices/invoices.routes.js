import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { InvoicesRepository } from './invoices.repository.js'
import { InvoicesService } from './invoices.service.js'
import { InvoicesController } from './invoices.controller.js'

// STT124/125 read existing invoices and generate their PDF representation only.
export function createInvoicesRouter(repository = new InvoicesRepository(), options = {}) {
  const router = Router()
  const controller = new InvoicesController(new InvoicesService(repository, options))
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next() })
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.listInvoices))
  router.get('/:id/pdf', asyncHandler(controller.downloadInvoicePdf))
  router.get('/:id', asyncHandler(controller.getInvoice))
  return router
}
