import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { TechnicianApplicationRepository } from './technician-application.repository.js'
import { validateTechnicianApplication } from './technician-application.validation.js'

export function createTechnicianApplicationRouter(repository = new TechnicianApplicationRepository()) {
  const router = Router()
  router.use(authenticate, requireRole('CUSTOMER'))

  router.get('/options', asyncHandler(async (_request, response) => {
    response.json({ data: await repository.options() })
  }))

  router.get('/me', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store').json({ data: await repository.status(request.auth.userId) })
  }))

  router.post('/', asyncHandler(async (request, response) => {
    const data = await repository.submit(request.auth.userId, validateTechnicianApplication(request.body))
    response.status(201).json({ data })
  }))

  return router
}
