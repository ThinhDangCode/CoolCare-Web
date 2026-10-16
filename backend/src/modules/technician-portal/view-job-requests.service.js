import { AppError, validateUuid } from '../../utils.js'
import { ViewJobRequestsRepository } from './view-job-requests.repository.js'
import { validateViewJobRequestsQuery } from './view-job-requests.validation.js'

export class ViewJobRequestsService {
  constructor(repository = new ViewJobRequestsRepository()) {
    this.repository = repository
  }

  async getViewJobRequests(userId, query = {}) {
    if (!userId) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập để tiếp tục.')
    }
    const validUserId = validateUuid(userId)
    const filters = validateViewJobRequestsQuery(query)
    const technician = await this.repository.findTechnicianByUserId(validUserId)

    if (!technician) {
      throw new AppError(403, 'TECHNICIAN_PROFILE_REQUIRED', 'Tài khoản chưa có hồ sơ kỹ thuật viên.')
    }
    if (technician.verification_status !== 'VERIFIED') {
      throw new AppError(403, 'TECHNICIAN_NOT_VERIFIED', 'Hồ sơ kỹ thuật viên chưa được xác minh.')
    }
    if (!technician.is_active || technician.account_status !== 'ACTIVE') {
      throw new AppError(403, 'TECHNICIAN_INACTIVE', 'Hồ sơ kỹ thuật viên hiện không hoạt động.')
    }

    const [total, rows] = await Promise.all([
      this.repository.countJobRequests(technician.id, filters.status),
      this.repository.findJobRequests(technician.id, filters),
    ])

    return {
      items: rows.map((row) => this.formatJobRequest(row)),
      filters: { status: filters.status ?? 'ALL' },
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    }
  }

  formatJobRequest(row) {
    return {
      id: row.request_id,
      status: row.request_status,
      storedStatus: row.stored_request_status,
      matchScore: row.match_score == null ? null : Number(row.match_score),
      matchReason: row.match_reason ?? null,
      requestedAt: row.requested_at,
      respondedAt: row.responded_at ?? null,
      expiresAt: row.expires_at ?? null,
      declineReason: row.decline_reason ?? null,
      cancelledAt: row.request_cancelled_at ?? null,
      cancellationReason: row.request_cancellation_reason ?? null,
      canRespond: row.request_status === 'SELECTED' && row.booking_status === 'TECHNICIAN_SELECTED',
      canComplete: row.request_status === 'ACCEPTED' && row.booking_status === 'ACCEPTED',
      canCancelAcceptedJob: row.request_status === 'ACCEPTED' && row.booking_status === 'ACCEPTED',
      booking: {
        id: row.booking_id,
        code: row.booking_code,
        status: row.booking_status,
        description: row.description ?? null,
        scheduledAt: row.scheduled_at,
        address: {
          addressLine: row.service_address,
          ward: row.ward,
          city: row.city,
          latitude: row.latitude == null ? null : Number(row.latitude),
          longitude: row.longitude == null ? null : Number(row.longitude),
        },
        recipient: {
          name: row.recipient_name,
          phone: row.recipient_phone,
        },
        pricing: {
          subtotal: Number(row.subtotal),
          discountAmount: Number(row.discount_amount),
          totalAmount: Number(row.total_amount),
        },
        units: Array.isArray(row.units) ? row.units : [],
        createdAt: row.booking_created_at,
        updatedAt: row.booking_updated_at,
        cancelledAt: row.booking_cancelled_at ?? null,
        cancellationReason: row.booking_cancellation_reason ?? null,
      },
      customer: {
        id: row.customer_id,
        name: row.customer_name,
        avatarUrl: row.customer_avatar_url ?? null,
      },
    }
  }
}
