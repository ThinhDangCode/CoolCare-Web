export class ComplaintService {
  constructor(repository) {
    this.repository = repository
  }
  list(filters) {
    return this.repository.list(filters)
  }
  get(id) {
    return this.repository.get(id)
  }
  resolve(id, input, actorId) {
    return this.repository.resolve(id, input, actorId)
  }
  createCompensationVoucher(id, input, actorId) {
    return this.repository.createCompensationVoucher(id, input, actorId)
  }
}
