import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { validateUuid } from '../management/management.validation.js'
import { writeManagementAudit } from '../management/management.audit.js'
import { TechnicianRepository } from './technician.repository.js'
import { validateTechnicianQuery, validatePenaltyQuery, validateReview, validateTechnicianUpdate, validateTechnicianSkills, validateTechnicianAreas } from './technician.validation.js'
import { TechnicianMutations } from './technician.mutations.js'
import { serviceCity, serviceWards } from './technician.areas.js'

export function createTechnicianRouter(repository = new TechnicianRepository(), writeAudit = writeManagementAudit, mutations = new TechnicianMutations()) {
  const router = Router()
  router.use(authenticate, requireRole('ADMIN'))
  const audit = (req, action, entityId) => writeAudit({ actorId: req.auth.userId, action, entityType: 'TECHNICIAN', entityId })
  router.get('/area-options', (_req,res) => res.json({data:{city:serviceCity,wards:serviceWards}}))
  router.get('/skill-options',asyncHandler(async (_req,res)=>res.json({data:await mutations.skillOptions()})))
  router.patch('/certifications/:id/review',asyncHandler(async (req,res)=>res.json({data:await mutations.certification(validateUuid(req.params.id),validateReview(req.body,true),req.auth.userId)})))
  router.patch('/:id/verification',asyncHandler(async (req,res)=>res.json({data:await mutations.verification(validateUuid(req.params.id),validateReview(req.body),req.auth.userId)})))
  router.patch('/:id',asyncHandler(async (req,res)=>res.json({data:await mutations.update(validateUuid(req.params.id),validateTechnicianUpdate(req.body),req.auth.userId)})))
  router.patch('/:id/skills',asyncHandler(async (req,res)=>res.json({data:await mutations.skills(validateUuid(req.params.id),validateTechnicianSkills(req.body),req.auth.userId)})))
  router.patch('/:id/areas',asyncHandler(async (req,res)=>res.json({data:await mutations.areas(validateUuid(req.params.id),validateTechnicianAreas(req.body),req.auth.userId)})))
  router.post('/:id/deactivate',asyncHandler(async (req,res)=>res.json({data:await mutations.deactivate(validateUuid(req.params.id),req.auth.userId)})))
  router.post('/:id/activate',asyncHandler(async (req,res)=>res.json({data:await mutations.activate(validateUuid(req.params.id),req.auth.userId)})))
  router.get('/options', asyncHandler(async (_req,res) => res.json({data:await repository.options()})))
  router.get('/penalties', asyncHandler(async (req,res) => {
    const data = await repository.penalties(validatePenaltyQuery(req.query))
    audit(req,'VIEW_TECHNICIAN_PENALTIES')
    res.json({data})
  }))
  router.get('/certifications', asyncHandler(async (req,res) => {
    const data = await repository.certifications(validateTechnicianQuery(req.query,true))
    audit(req,'VIEW_TECHNICIAN_CERTIFICATIONS')
    res.json({data})
  }))
  router.get('/', asyncHandler(async (req,res) => {
    const data = await repository.list(validateTechnicianQuery(req.query))
    audit(req,'VIEW_TECHNICIANS')
    res.json({data})
  }))
  router.get('/:id', asyncHandler(async (req,res) => {
    const id = validateUuid(req.params.id)
    const data = await repository.detail(id)
    audit(req,'VIEW_TECHNICIAN_IDENTITY_AND_DETAIL',id)
    res.set('Cache-Control','no-store').json({data})
  }))
  return router
}
