
import { AppError, validateUuid } from '../../utils.js'
import { MyBookingsRepository } from './my-bookings.repository.js'

const BOOKING_STATUSES = [
  'PENDING',
  'TECHNICIAN_SELECTED',
  'ACCEPTED',
  'IN_PROGRESS',
  'WAITING_QUOTATION',
  'QUOTATION_SENT',
  'QUOTATION_ACCEPTED',
  'QUOTATION_REJECTED',
  'WAITING_CONFIRMATION',
  'COMPLETED',
  'CANCELLED',
]

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export class MyBookingsService {
  constructor(
    repository = new MyBookingsRepository()
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

  validateStatus(value) {
    if (
      value === undefined ||
      value === null ||
      value === ''
    ) {
      return null
    }

    if (
      typeof value !== 'string' ||
      !BOOKING_STATUSES.includes(value)
    ) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'Invalid booking status.'
      )
    }

    return value
  }

  validatePositiveInteger(
    value,
    fieldName,
    defaultValue,
    maximum = null
  ) {
    if (value === undefined) {
      return defaultValue
    }

    const parsed = Number(value)

    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 1 ||
      (maximum !== null && parsed > maximum)
    ) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        maximum === null
          ? `${fieldName} must be a positive integer.`
          : `${fieldName} must be an integer between 1 and ${maximum}.`
      )
    }

    return parsed
  }

  validateQuery(query = {}) {
    const status = this.validateStatus(query.status)

    const page = this.validatePositiveInteger(
      query.page,
      'Page',
      DEFAULT_PAGE
    )

    const limit = this.validatePositiveInteger(
      query.limit,
      'Limit',
      DEFAULT_LIMIT,
      MAX_LIMIT
    )

    const offset = (page - 1) * limit

    if (!Number.isSafeInteger(offset)) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'Pagination offset is too large.'
      )
    }

    return {
      status,
      page,
      limit,
      offset,
    }
  }

  async getCustomerProfile(userId) {
    const customer =
      await this.repository.findCustomerByUserId(
        userId
      )

    if (!customer) {
      throw new AppError(
        403,
        'CUSTOMER_PROFILE_REQUIRED',
        'An active customer profile is required.'
      )
    }

    return customer
  }

  formatBooking(booking) {
    const technician = booking.technician_id
      ? {
          id: booking.technician_id,
          name: booking.technician_name,
          avatarUrl:
            booking.technician_avatar_url ?? null,
          rating:
            booking.technician_rating == null
              ? null
              : Number(booking.technician_rating),
          requestStatus: booking.request_status,
        }
      : null

    return {
      id: booking.id,
      bookingCode: booking.booking_code,
      status: booking.status,
      description: booking.description ?? null,

      scheduledAt: booking.scheduled_at,

      address: {
        addressLine: booking.service_address,
        ward: booking.ward,
        city: booking.city,
      },

      recipient: {
        name: booking.recipient_name,
        phone: booking.recipient_phone,
      },

      pricing: {
        subtotal: Number(booking.subtotal),
        discountAmount: Number(
          booking.discount_amount
        ),
        totalAmount: Number(booking.total_amount),
      },

      unitCount: Number(booking.unit_count ?? 0),
      serviceCount: Number(
        booking.service_count ?? 0
      ),
      reviewed: booking.reviewed === true,
      serviceNames: booking.service_names ?? null,

      technician,

      createdAt: booking.created_at,
      updatedAt: booking.updated_at,
      completedAt: booking.completed_at ?? null,
      cancelledAt: booking.cancelled_at ?? null,
    }
  }

  /**
   * #41 - View My Bookings
   *
   * Return only bookings owned by the
   * authenticated customer.
   *
   * Supports:
   * - Optional status filter
   * - Pagination
   * - Empty results
   */
  async getMyBookings(userId, query = {}) {
    const validUserId =
      this.validateUserId(userId)

    const {
      status,
      page,
      limit,
      offset,
    } = this.validateQuery(query)

    const customer =
      await this.getCustomerProfile(validUserId)

    const [total, bookings] = await Promise.all([
      this.repository.countCustomerBookings(
        customer.id,
        status
      ),

      this.repository.findCustomerBookings(
        customer.id,
        {
          status,
          limit,
          offset,
        }
      ),
    ])

    return {
      items: bookings.map((booking) =>
        this.formatBooking(booking)
      ),

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }
}
