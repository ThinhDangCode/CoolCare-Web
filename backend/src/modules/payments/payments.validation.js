import { requireValidBody } from '../../utils.js'

const statuses = ['ALL', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED']
const methods = ['ALL', 'CASH', 'VNPAY', 'ZALOPAY', 'FREE']
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validatePaymentId(id) {
  requireValidBody({
    id: typeof id === 'string' && uuid.test(id) ? null : 'ID thanh toán không hợp lệ.',
  })
  return id
}

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  // PostgreSQL has no year zero. Keep the API within the four-digit AD calendar.
  if (Number(value.slice(0, 4)) < 1) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validatePaymentListQuery(query = {}) {
  const errors = {}
  const integer = (key, fallback, max) => {
    if (query[key] === undefined) return fallback
    const value = query[key]
    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      Number(value) < 1 ||
      Number(value) > max
    ) {
      errors[key] = `Giá trị phải là số nguyên từ 1 đến ${max}.`
    }
    return Number(value)
  }
  const page = integer('page', 1, 1_000_000)
  const limit = integer('limit', 10, 100)
  if (
    query.search !== undefined &&
    (typeof query.search !== 'string' || query.search.length > 150)
  ) {
    errors.search = 'Từ khóa phải là chuỗi tối đa 150 ký tự.'
  }
  if (query.status !== undefined && !statuses.includes(query.status)) {
    errors.status = 'Trạng thái thanh toán không hợp lệ.'
  }
  if (query.method !== undefined && !methods.includes(query.method)) {
    errors.method = 'Phương thức thanh toán không hợp lệ.'
  }
  for (const key of ['from', 'to']) {
    if (query[key] !== undefined && !validCalendarDate(query[key])) {
      errors[key] = 'Ngày phải có định dạng YYYY-MM-DD, tồn tại và có năm từ 0001 đến 9999.'
    }
  }
  if (!errors.from && !errors.to && query.from && query.to && query.from > query.to) {
    errors.to = 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.'
  }
  requireValidBody(errors)
  return {
    page,
    limit,
    search: query.search?.trim() ?? '',
    status: query.status ?? 'ALL',
    method: query.method ?? 'ALL',
    from: query.from,
    to: query.to,
  }
}
