import { AppError } from '../../utils.js'

export class CustomerBookingController {
  constructor(service, technicianMatchingService) {
    this.service = service
    this.technicianMatchingService = technicianMatchingService
  }

  createBooking = async (request, response) => {
    const userId = request.auth?.userId
    if (!userId) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.')
    }
    const booking = await this.service.createBooking(userId, request.body)
    response.status(201).json({ data: booking })
  }

  getRecommendedTechnicians = async (request, response) => {
    const result = await this.technicianMatchingService.getRecommendedTechnicians(
      request.auth?.userId, request.params.bookingId, request.query
    )
    response.status(200).json({ data: result })
  }

  selectTechnician = async (request, response) => {
    const result = await this.technicianMatchingService.selectTechnician(
      request.auth?.userId, request.params.bookingId, request.body?.technicianId
    )
    response.status(200).json({ data: result })
  }
}
