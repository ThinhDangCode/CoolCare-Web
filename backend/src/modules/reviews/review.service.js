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
}
