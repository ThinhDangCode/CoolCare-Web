import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'

export function createUserRouter(controller) {
  const router = Router()
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.list))
  router.patch('/:id/status', asyncHandler(controller.changeStatus))
  return router
}
