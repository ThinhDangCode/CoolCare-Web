import { validateUuid } from '../../utils.js'
import { AcceptDeclineJobRequestRepository } from './accept-decline-job-request.repository.js'
import { validateAcceptDeclineJobRequest } from './accept-decline-job-request.validation.js'

export class AcceptDeclineJobRequestService {
  constructor(repository = new AcceptDeclineJobRequestRepository()) {
    this.repository = repository
  }

  async respond(userId, requestId, body) {
    const validUserId = validateUuid(userId)
    const validRequestId = validateUuid(requestId)
    const input = validateAcceptDeclineJobRequest(body)
    const result = await this.repository.respond(validUserId, validRequestId, input)
    return {
      id: result.id,
      bookingId: result.booking_id,
      status: result.status,
      respondedAt: result.responded_at,
      declineReason: result.decline_reason ?? null,
      booking: {
        id: result.booking.id,
        code: result.booking.booking_code,
        status: result.booking.status,
        updatedAt: result.booking.updated_at,
      },
    }
  }
}
