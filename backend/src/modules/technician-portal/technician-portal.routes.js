import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { AppError, asyncHandler } from '../../utils.js'
import { TechnicianPortalRepository } from './technician-portal.repository.js'
import {
  validateCertificationIdentity,
  validateCertificationSubmission,
  validateTechnicianSkillId,
  validateTechnicianSkillSubmission,
} from './technician-portal.validation.js'

export function createTechnicianPortalRouter(repository = new TechnicianPortalRepository()) {
  const router = Router()
  router.use(authenticate, requireRole('CUSTOMER'))

  router.get('/dashboard', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store').json({ data: await repository.dashboard(request.auth.userId) })
  }))

  router.patch('/availability', asyncHandler(async (request, response) => {
    if (!request.body || !['ONLINE', 'OFFLINE'].includes(request.body.status) || Object.keys(request.body).some(key => key !== 'status')) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Availability must be ONLINE or OFFLINE.')
    }
    response.json({ data: await repository.setAvailability(request.auth.userId, request.body.status) })
  }))

  router.get('/skills', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store').json({ data: await repository.skills(request.auth.userId) })
  }))

  router.get('/skills/options', asyncHandler(async (request, response) => {
    response.json({ data: await repository.skillOptions(request.auth.userId) })
  }))

  router.post('/skills', asyncHandler(async (request, response) => {
    const data = await repository.addSkill(
      request.auth.userId,
      validateTechnicianSkillSubmission(request.body),
    )
    response.status(201).json({ data })
  }))

  router.delete('/skills/:id', asyncHandler(async (request, response) => {
    const data = await repository.removeSkill(
      request.auth.userId,
      validateTechnicianSkillId(request.params.id),
    )
    response.json({ data })
  }))

  router.post('/certifications', asyncHandler(async (request, response) => {
    const data = await repository.addCertification(
      request.auth.userId,
      validateCertificationSubmission(request.body),
    )
    response.status(201).json({ data })
  }))

  router.get('/certifications/check-number', asyncHandler(async (request, response) => {
    const identity = validateCertificationIdentity(request.query)
    await repository.assertCertificationAvailable(request.auth.userId, identity)
    response.json({ data: { available: true } })
  }))

  router.post('/certifications/:id/resubmit', asyncHandler(async (request, response) => {
    const data = await repository.resubmitCertification(
      request.auth.userId,
      request.params.id,
      validateCertificationSubmission(request.body),
    )
    response.status(201).json({ data })
  }))

  return router
}
