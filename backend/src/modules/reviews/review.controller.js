import { validateReviewInput } from './review.validation.js'

export class ReviewController {
  constructor(service) {
    this.service = service
  }

  listBookings = async (request, response) =>
    response.json({ data: await this.service.listBookings(request.auth.userId) })

  create = async (request, response) =>
    response
      .status(201)
      .json({
        data: await this.service.create(request.auth.userId, validateReviewInput(request.body)),
      })
}
