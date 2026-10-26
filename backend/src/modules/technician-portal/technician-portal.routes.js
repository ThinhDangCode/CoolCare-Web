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
  validateMyRatingsQuery,
} from './technician-portal.validation.js'
import { validateTechnicianAreas } from '../technicians/technician.validation.js'
import { ViewJobRequestsService } from './view-job-requests.service.js'
import { AcceptDeclineJobRequestService } from './accept-decline-job-request.service.js'
import { UpdateJobStatusService } from './update-job-status.service.js'
import { CancelAcceptedJobService } from './cancel-accepted-job.service.js'
import { AcServiceHistoryService } from './ac-service-history.service.js'
import { UpdateAcUnitRepository } from './update-ac-unit.repository.js'

export function createTechnicianPortalRouter(
  repository = new TechnicianPortalRepository(),
  viewJobRequestsService = new ViewJobRequestsService(),
  acceptDeclineJobRequestService = new AcceptDeclineJobRequestService(),
  updateJobStatusService = new UpdateJobStatusService(),
  cancelAcceptedJobService = new CancelAcceptedJobService(),
  acServiceHistoryService = new AcServiceHistoryService(),
) {
  const router = Router()
  router.use(authenticate, requireRole('CUSTOMER'))

  router.get('/dashboard', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store').json({ data: await repository.dashboard(request.auth.userId) })
  }))

  router.get('/ratings', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store').json({
      data: await repository.ratings(request.auth.userId, validateMyRatingsQuery(request.query)),
    })
  }))

  router.get('/job-requests', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store').json({
      data: await viewJobRequestsService.getViewJobRequests(request.auth.userId, request.query),
    })
  }))

  router.patch('/job-requests/:id/response', asyncHandler(async (request, response) => {
    response.json({
      data: await acceptDeclineJobRequestService.respond(
        request.auth.userId,
        request.params.id,
        request.body,
      ),
    })
  }))

  router.patch('/job-requests/:id/status', asyncHandler(async (request, response) => {
    response.json({
      data: await updateJobStatusService.update(
        request.auth.userId,
        request.params.id,
        request.body,
      ),
    })
  }))

  router.patch('/job-requests/:id/cancel', asyncHandler(async (request, response) => {
    response.json({
      data: await cancelAcceptedJobService.cancel(
        request.auth.userId,
        request.params.id,
        request.body,
      ),
    })
  }))

  router.patch('/job-requests/:id/units/:unitId/ac-information', asyncHandler(async (request, response) => {
    response.json({ data: await new UpdateAcUnitRepository().update(
      request.auth.userId, request.params.id, request.params.unitId, request.body,
    ) })
  }))

  router.get('/job-requests/:id/units/:unitId/service-history', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store').json({
      data: await acServiceHistoryService.getHistory(
        request.auth.userId,request.params.id,request.params.unitId,request.query,
      ),
    })
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
