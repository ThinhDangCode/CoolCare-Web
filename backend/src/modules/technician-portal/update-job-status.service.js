import { validateUuid } from '../../utils.js'
import { UpdateJobStatusRepository } from './update-job-status.repository.js'
import { validateUpdateJobStatus } from './update-job-status.validation.js'

export class UpdateJobStatusService {
  constructor(repository = new UpdateJobStatusRepository()) {
    this.repository = repository
  }

  async update(userId, requestId, body) {
    const validUserId = validateUuid(userId)
    const validRequestId = validateUuid(requestId)
    validateUpdateJobStatus(body)
    const result = await this.repository.complete(validUserId, validRequestId)
    return {
      id: result.id,
      bookingId: result.booking_id,
      status: result.status,
      booking: {
        id: result.booking.id,
        code: result.booking.booking_code,
        status: result.booking.status,
        completedAt: result.booking.completed_at,
        updatedAt: result.booking.updated_at,
      },
    }
  }
}
