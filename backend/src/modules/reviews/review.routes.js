import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'

export function createReviewRouter(controller) {
  const router = Router()
  router.use(authenticate, requireRole('CUSTOMER'))
  router.get('/bookings', asyncHandler(controller.listBookings))
  router.post('/reviews', asyncHandler(controller.create))
  router.patch('/reviews/:id', asyncHandler(controller.update))
  router.delete('/reviews/:id', asyncHandler(controller.remove))
  return router
}
