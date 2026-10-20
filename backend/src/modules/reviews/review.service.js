export class ReviewService {
  constructor(repository) {
    this.repository = repository
  }

  listBookings(userId) {
    return this.repository.listBookings(userId)
  }

  create(userId, input) {
    return this.repository.create(userId, input)
  }

  update(userId, reviewId, input) {
    return this.repository.update(userId, reviewId, input)
  }

  remove(userId, reviewId) {
    return this.repository.remove(userId, reviewId)
  }
}
