import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'

export function createComplaintRouter(controller) {
  const router = Router()
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.list))
  router.get('/:id', asyncHandler(controller.get))
  router.patch('/:id/resolve', asyncHandler(controller.resolve))
  router.post('/:id/compensation-voucher', asyncHandler(controller.createCompensationVoucher))
  return router
}
