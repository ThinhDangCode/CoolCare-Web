import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'

export function createVoucherRouter(controller) {
  const router = Router()
  router.use(authenticate, requireRole('CUSTOMER'))
  router.get('/bookings/:id/available-vouchers', asyncHandler(controller.available))
  router.post('/bookings/:id/voucher', asyncHandler(controller.apply))
  return router
}

export function createAdminVoucherRouter(controller) {
  const router = Router()
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/vouchers', asyncHandler(controller.list))
  router.post('/vouchers', asyncHandler(controller.create))
  router.patch('/vouchers/:id', asyncHandler(controller.update))
  router.patch('/vouchers/:id/status', asyncHandler(controller.changeStatus))
  router.get('/voucher-usages', asyncHandler(controller.listUsages))
  return router
}
