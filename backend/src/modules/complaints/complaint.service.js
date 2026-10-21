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
  listMine(userId, filters) {
    return this.repository.listMine(userId, filters)
  }
  getMine(userId, id) {
    return this.repository.getMine(userId, id)
  }
  submit(userId, input) {
    return this.repository.submit(userId, input)
  }
}
