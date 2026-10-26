export class VoucherService {
  constructor(repository) {
    this.repository = repository
  }

  available(userId, bookingId) {
    return this.repository.available(userId, bookingId)
  }
  apply(userId, bookingId, code) {
    return this.repository.apply(userId, bookingId, code)
  }
  remove(userId, bookingId) {
    return this.repository.remove(userId, bookingId)
  }
  list(filters) {
    return this.repository.list(filters)
  }
  create(input, actorId) {
    return this.repository.save(null, input, actorId, 'CREATE_VOUCHER')
  }
  update(id, input, actorId) {
    return this.repository.save(id, input, actorId, 'UPDATE_VOUCHER')
  }
  changeStatus(id, status, actorId) {
    return this.repository.save(id, { is_active: status }, actorId, 'TOGGLE_VOUCHER_STATUS')
  }
  listUsages(filters) {
    return this.repository.listUsages(filters)
  }
}
