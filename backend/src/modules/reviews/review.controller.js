import { validateReviewInput, validateReviewUpdateInput } from './review.validation.js'
import { validateUuid } from '../../utils.js'

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

  update = async (request, response) =>
    response.json({
      data: await this.service.update(
        request.auth.userId,
        validateUuid(request.params.id),
        validateReviewUpdateInput(request.body)
      ),
    })

  remove = async (request, response) => {
    await this.service.remove(request.auth.userId, validateUuid(request.params.id))
    response.status(204).end()
  }
}
