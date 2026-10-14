import { Router } from 'express'
import { asyncHandler } from '../../utils.js'
import { authenticate, requireRole } from '../../middleware/authenticate.js'

export function createBlogRouter(controller) {
  const router = Router()
  router.get('/', asyncHandler(controller.listPublished))
  router.get('/:id', asyncHandler(controller.getPublished))
  return router
}

export function createAdminBlogRouter(controller) {
  const router = Router()
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.listAdmin))
  router.get('/:id', asyncHandler(controller.getAdmin))
  router.post('/', asyncHandler(controller.create))
  router.patch('/:id', asyncHandler(controller.update))
  router.patch('/:id/status', asyncHandler(controller.changeStatus))
  return router
}
