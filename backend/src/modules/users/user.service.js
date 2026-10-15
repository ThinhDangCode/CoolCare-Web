export class UserService {
  constructor(repository) {
    this.repository = repository
  }
  list(filters) {
    return this.repository.list(filters)
  }
  changeStatus(id, status, actorId) {
    return this.repository.changeStatus(id, status, actorId)
  }
}
