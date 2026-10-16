import { validateUuid } from '../../utils.js'
import { CancelAcceptedJobRepository } from './cancel-accepted-job.repository.js'
import { validateCancelAcceptedJob } from './cancel-accepted-job.validation.js'

export class CancelAcceptedJobService {
  constructor(repository = new CancelAcceptedJobRepository()) {
    this.repository = repository
  }

  async cancel(userId, requestId, body) {
    const input = validateCancelAcceptedJob(body)
    const result = await this.repository.cancel(validateUuid(userId), validateUuid(requestId), input.reason)
    return {
      id: result.id,
      bookingId: result.booking_id,
      status: result.status,
      cancelledAt: result.cancelled_at,
      cancellationReason: result.cancellation_reason,
      booking: {
        id: result.booking.id,
        code: result.booking.booking_code,
        status: result.booking.status,
        cancelledAt: result.booking.cancelled_at,
        cancellationReason: result.booking.cancellation_reason,
        updatedAt: result.booking.updated_at,
      },
      penalty: result.penalty == null ? null : {
        id: result.penalty.id,
        type: result.penalty.penalty_type,
        points: result.penalty.penalty_points,
        status: result.penalty.status,
        appliedAt: result.penalty.applied_at,
        expiresAt: result.penalty.expires_at,
      },
    }
  }
}
