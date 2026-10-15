import { Router } from 'express'
import {
  authenticate,
  requireRole,
} from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'

import { MyBookingsController } from './my-bookings.controller.js'
import { BookingDetailController } from './booking-detail.controller.js'

export function createCustomerBookingRouter(controller) {
  const router = Router()

  const myBookingsController = new MyBookingsController()
  const bookingDetailController = new BookingDetailController()

  router.use(
    authenticate,
    requireRole('CUSTOMER')
  )

  /**
   * #34 - Create Booking
   *
   * POST /api/bookings
   */
  router.post(
    '/',
    asyncHandler(controller.createBooking)
  )

  /**
   * #39 - View Recommended Technicians
   *
   * GET /api/bookings/:bookingId/recommended-technicians
   */
  router.get(
    '/:bookingId/recommended-technicians',
    asyncHandler(controller.getRecommendedTechnicians)
  )

  /**
   * #40 - Select Technician
   *
   * POST /api/bookings/:bookingId/technician-selection
   */
  router.post(
    '/:bookingId/technician-selection',
    asyncHandler(controller.selectTechnician)
  )

  // #41 - View My Bookings
  router.get('/', asyncHandler(myBookingsController.getMyBookings))

  // #42 Booking detail, #43 status timeline, #44 customer cancellation
  router.get('/:bookingId', asyncHandler(bookingDetailController.getDetail))
  router.get('/:bookingId/timeline', asyncHandler(bookingDetailController.getTimeline))
  router.post('/:bookingId/cancel', asyncHandler(bookingDetailController.cancel))

  return router
}