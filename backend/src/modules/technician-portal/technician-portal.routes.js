import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { TechnicianPortalRepository } from './technician-portal.repository.js'
import {
  validateCertificationIdentity,
  validateCertificationSubmission,
  validateTechnicianSkillId,
  validateTechnicianSkillSubmission,
  validateSetAvailabilityStatus,
} from './technician-portal.validation.js'
import { validateTechnicianAreas } from '../technicians/technician.validation.js'

export function createTechnicianPortalRouter(repository = new TechnicianPortalRepository()) {
  const router = Router()
  router.use(authenticate, requireRole('CUSTOMER'))

  router.get('/dashboard', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store').json({ data: await repository.dashboard(request.auth.userId) })
  }))

  router.get('/availability', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store').json({
      data: await repository.availability(request.auth.userId),
    })
  }))

  router.patch('/availability', asyncHandler(async (request, response) => {
    const input = validateSetAvailabilityStatus(request.body)
    response.json({
      data: await repository.setAvailability(request.auth.userId, input.status),
    })
  }))

  router.get('/areas/options', (_request, response) => {
    response.json({ data: repository.areaOptions() })
  })

  router.get('/areas', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store').json({ data: await repository.areas(request.auth.userId) })
  }))

  router.put('/areas', asyncHandler(async (request, response) => {
    const data = await repository.replaceAreas(
      request.auth.userId,
      validateTechnicianAreas(request.body),
    )
    response.json({ data })
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
