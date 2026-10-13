export class BlogService {
  constructor(repository) {
    this.repository = repository
  }

  listPublished(filters) {
    return this.repository.listPublished(filters)
  }

  getPublished(id) {
    return this.repository.getPublished(id)
  }
  listAdmin(filters) {
    return this.repository.listAdmin(filters)
  }
  getAdmin(id) {
    return this.repository.getAdmin(id)
  }
  create(input, actorId) {
    return this.repository.save(null, input, actorId, 'CREATE_BLOG')
  }
  update(id, input, actorId) {
    return this.repository.save(id, input, actorId, 'UPDATE_BLOG')
  }
  changeStatus(id, status, actorId) {
    return this.repository.save(id, { status }, actorId, 'TOGGLE_BLOG_STATUS')
  }
}
