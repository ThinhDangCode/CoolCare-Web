import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler, validateUuid } from '../../utils.js'
import { writeAdminAudit as writeManagementAudit } from '../audit/admin-audit.js'
import { BookingRepository } from './booking.repository.js'
import { validateBookingQuery } from './booking.validation.js'

export function createBookingRouter(repository = new BookingRepository(), audit = writeManagementAudit) {
  const router = Router()
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/options', asyncHandler(async (_req,res) => res.json({data:await repository.options()})))
  router.get('/', asyncHandler(async (req,res) => {
    const data = await repository.list(validateBookingQuery(req.query))
    audit({actorId:req.auth.userId,action:'VIEW_BOOKINGS',entityType:'BOOKING'})
    res.set('Cache-Control','no-store').json({data})
  }))
  router.get('/:id', asyncHandler(async (req,res) => {
    const id = validateUuid(req.params.id), data = await repository.detail(id)
    audit({actorId:req.auth.userId,action:'VIEW_BOOKING_DETAIL',entityType:'BOOKING',entityId:id})
    res.set('Cache-Control','no-store').json({data})
  }))
  return router
}
