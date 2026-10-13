import { AppError, requireValidBody } from '../../utils.js'

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function validateUserId(value) {
  if (!uuidPattern.test(value ?? '')) throw new AppError(422, 'INVALID_ID', 'ID không hợp lệ.')
  return value
}

export function validateUserListQuery(query) {
  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? 10 : Number(query.limit)
  const errors = {}
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000) errors.page = 'Trang không hợp lệ.'
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    errors.limit = 'Số dòng phải từ 1 đến 100.'
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 150))
    errors.search = 'Từ khóa không hợp lệ.'
  if (query.status !== undefined && !['ALL', 'ACTIVE', 'LOCKED', 'INACTIVE'].includes(query.status))
    errors.status = 'Trạng thái không hợp lệ.'
  if (query.role !== undefined && !['ALL', 'ADMIN', 'CUSTOMER', 'TECHNICIAN'].includes(query.role))
    errors.role = 'Vai trò không hợp lệ.'
  if (query.sort_by !== undefined && !['user_number', 'full_name'].includes(query.sort_by))
    errors.sort_by = 'Cột sắp xếp không hợp lệ.'
  if (query.sort_order !== undefined && !['asc', 'desc'].includes(query.sort_order))
    errors.sort_order = 'Thứ tự sắp xếp không hợp lệ.'
  requireValidBody(errors)
  return {
    page,
    limit,
    search: query.search?.trim() ?? '',
    status: query.status ?? 'ALL',
    role: query.role ?? 'ALL',
    sortBy: query.sort_by ?? 'user_number',
    sortOrder: query.sort_order ?? 'asc',
  }
}

export function validateUserStatus(body) {
  if (!body || Object.keys(body).length !== 1 || !['ACTIVE', 'LOCKED'].includes(body.status))
    throw new AppError(422, 'VALIDATION_ERROR', 'Trạng thái phải là ACTIVE hoặc LOCKED.', {
      status: 'Trạng thái không hợp lệ.',
    })
  return body.status
}
