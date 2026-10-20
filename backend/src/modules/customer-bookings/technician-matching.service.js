import { reconcileTechnicianRequest } from './reconcile-technician-request.js'

import { AppError, validateUuid } from '../../utils.js'
import { withTransaction } from '../../config/database.js'
import {
  TechnicianMatchingRepository,
  RECOMMENDATION_LIMIT,
} from './technician-matching.repository.js'

export class TechnicianMatchingService {
  constructor(
    repository = new TechnicianMatchingRepository()
  ) {
    this.repository = repository
  }

  validateUserId(userId) {
    if (!userId) {
      throw new AppError(
        401,
        'UNAUTHORIZED',
        'Authentication is required.'
      )
    }

    return validateUuid(userId)
  }

  validateBookingId(bookingId) {
    return validateUuid(bookingId)
  }

  validateTechnicianId(technicianId) {
    if (!technicianId) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'Technician ID is required.'
      )
    }

    return validateUuid(technicianId)
  }

  validateLimit(value) {
    if (value === undefined) {
      return RECOMMENDATION_LIMIT
    }

    const limit = Number(value)

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > RECOMMENDATION_LIMIT
    ) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        `Limit must be an integer between 1 and ${RECOMMENDATION_LIMIT}.`
      )
    }

    return limit
  }

  async getCustomerBooking(
    userId,
    bookingId,
    db
  ) {
    if (!db) await reconcileTechnicianRequest(userId, bookingId)
    const booking =
      await this.repository.findCustomerBooking(
        bookingId,
        userId,
        db
      )

    if (!booking) {
      throw new AppError(
        404,
        'BOOKING_NOT_FOUND',
        'Booking was not found.'
      )
    }

    return booking
  }

  validateRecommendationStatus(booking) {
    if (booking.status !== 'PENDING') {
      throw new AppError(
        409,
        'INVALID_BOOKING_STATUS',
        'Technicians can only be selected for pending bookings.'
      )
    }

    const scheduledTime = new Date(
      booking.scheduled_at
    ).getTime()

    if (
      !Number.isFinite(scheduledTime) ||
      scheduledTime <= Date.now()
    ) {
      throw new AppError(
        409,
        'BOOKING_SCHEDULE_EXPIRED',
        'The preferred service schedule has expired.'
      )
    }
  }

  formatTechnician(technician) {
    const rawAreas = technician.service_areas

    const serviceAreas = Array.isArray(rawAreas)
      ? rawAreas
          .map((area) => {
            if (typeof area === 'string') {
              return area.trim()
            }

            if (
              area === null ||
              typeof area !== 'object'
            ) {
              return ''
            }

            return [
              area.ward,
              area.city,
            ]
              .filter(Boolean)
              .join(', ')
          })
          .filter(Boolean)
      : []

    return {
      id: technician.id,
      name: technician.full_name,
      avatarUrl: technician.avatar_url ?? null,

      rating:
        technician.rating_average == null
          ? null
          : Number(technician.rating_average),

      reviewCount: Number(
        technician.total_reviews ?? 0
      ),

      experienceYears:
        technician.years_experience == null
          ? null
          : Number(technician.years_experience),

      about: technician.bio ?? null,

      skills: Array.isArray(technician.skills)
        ? technician.skills
        : [],

      serviceAreas,
    }
  }

  /**
   * #39 - View Recommended Technicians
   *
   * Only technicians satisfying the current
   * matching conditions are returned.
   */
  async getRecommendedTechnicians(
    userId,
    bookingId,
    query = {}
  ) {
    const validUserId =
      this.validateUserId(userId)

    const validBookingId =
      this.validateBookingId(bookingId)

    const limit =
      this.validateLimit(query.limit)

    const booking =
      await this.getCustomerBooking(
        validUserId,
        validBookingId
      )

    this.validateRecommendationStatus(booking)

    const existingRequest =
      await this.repository.findExistingRequest(
        validBookingId
      )

    if (existingRequest) {
      throw new AppError(
        409,
        'TECHNICIAN_ALREADY_SELECTED',
        'An active technician request already exists for this booking.'
      )
    }

    const technicians =
      await this.repository.findRecommendedTechnicians(
        validBookingId,
        { limit }
      )

    return {
      bookingId: booking.id,
      scheduledAt: booking.scheduled_at,
      total: technicians.length,
      items: technicians.map((technician) =>
        this.formatTechnician(technician)
      ),
    }
  }

  /**
   * #40 - Select Technician
   *
   * The customer sends a request to a recommended
   * technician.
   *
   * SELECTED is not ACCEPTED.
   */
  async selectTechnician(
    userId,
    bookingId,
    technicianId
  ) {
    const validUserId =
      this.validateUserId(userId)

    const validBookingId =
      this.validateBookingId(bookingId)

    const validTechnicianId =
      this.validateTechnicianId(technicianId)

    return withTransaction(async (db) => {
      // 1. Lock booking and verify customer ownership.
      const booking =
        await this.repository.lockCustomerBooking(
          validBookingId,
          validUserId,
          db
        )

      if (!booking) {
        throw new AppError(
          404,
          'BOOKING_NOT_FOUND',
          'Booking was not found.'
        )
      }

      // 2. Verify booking status and schedule.
      this.validateRecommendationStatus(booking)

      // 3. Reject duplicate active requests.
      const existingRequest =
        await this.repository.findExistingRequest(
          validBookingId,
          db
        )

      if (existingRequest) {
        throw new AppError(
          409,
          'TECHNICIAN_ALREADY_SELECTED',
          'An active technician request already exists for this booking.'
        )
      }

      // 4. Lock the selected technician profile.
      const technician =
        await this.repository.lockTechnician(
          validTechnicianId,
          db
        )

      if (!technician) {
        throw new AppError(
          404,
          'TECHNICIAN_NOT_FOUND',
          'Technician was not found.'
        )
      }

      // 5. Recheck the technician against the
      // current recommendation list.
      const selectedTechnician =
        await this.repository.findEligibleTechnician(
          validBookingId,
          validTechnicianId,
          db
        )

      if (!selectedTechnician) {
        throw new AppError(
          409,
          'TECHNICIAN_UNAVAILABLE',
          'This technician is no longer eligible. Please refresh the recommendation list.'
        )
      }

      // 6. Insert the technician request.
      // The database validates technician eligibility
      // again through its existing trigger.
      const request =
        await this.repository.insertTechnicianRequest(
          validBookingId,
          validTechnicianId,
          db
        )

      // 7. Change the booking status.
      // This does not accept the job.
      const updatedBooking =
        await this.repository.markTechnicianSelected(
          validBookingId,
          db
        )

      if (!updatedBooking) {
        throw new AppError(
          409,
          'INVALID_BOOKING_STATUS',
          'Booking status changed. Please refresh and try again.'
        )
      }

      // 8. Record the booking status timeline.
      await this.repository.insertBookingStatusHistory(
        validBookingId,
        validUserId,
        db
      )

      // 9. Return the selection result.
      return {
        booking: {
          id: updatedBooking.id,
          bookingCode: updatedBooking.booking_code,
          status: updatedBooking.status,
          scheduledAt: updatedBooking.scheduled_at,
        },

        technician: this.formatTechnician(
          selectedTechnician
        ),

        request: {
          id: request.id,
          status: request.status,
          requestedAt: request.requested_at,
        },

        message:
          'Technician request sent successfully. Waiting for technician response.',
      }
    })
  }
}
