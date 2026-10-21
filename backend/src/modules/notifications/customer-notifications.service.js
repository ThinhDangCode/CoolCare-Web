import { AppError, validateUuid } from '../../utils.js'
import { CustomerNotificationsRepository } from './customer-notifications.repository.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function positiveInteger(value, name, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new AppError(422, 'VALIDATION_ERROR', `${name} không hợp lệ.`)
  }
  return parsed
}

export class CustomerNotificationsService {
  constructor(repository = new CustomerNotificationsRepository()) {
    this.repository = repository
  }

  validateUserId(userId) {
    if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập để tiếp tục.')
    return validateUuid(userId)
  }

  async list(userId, query = {}) {
    const validUserId = this.validateUserId(userId)
    if (query.unreadOnly !== undefined && !['true', 'false'].includes(query.unreadOnly)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'unreadOnly phải là true hoặc false.')
    }
    const page = positiveInteger(query.page, 'Trang', 1)
    const limit = positiveInteger(query.limit, 'Số lượng', DEFAULT_LIMIT, MAX_LIMIT)
    const offset = (page - 1) * limit
    if (!Number.isSafeInteger(offset)) throw new AppError(422, 'VALIDATION_ERROR', 'Trang không hợp lệ.')
    const result = await this.repository.list(validUserId, {
      unreadOnly: query.unreadOnly === 'true',
      limit,
      offset,
    })
    return {
      ...result,
      pagination: {
        page,
        limit,
        total: result.pagination.total,
        totalPages: Math.ceil(result.pagination.total / limit),
        unreadCount: result.pagination.unreadCount,
      },
    }
  }

  markRead(userId, notificationId) {
    return this.repository.markRead(this.validateUserId(userId), validateUuid(notificationId))
  }

  markAllRead(userId) {
    return this.repository.markAllRead(this.validateUserId(userId))
  }
}
