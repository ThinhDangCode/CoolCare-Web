import { requireValidBody } from '../../utils.js'

const statuses = ['ALL', 'OPEN', 'CALCULATED', 'SETTLED', 'OVERDUE']
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateSettlementId(id) {
  requireValidBody({ id: typeof id === 'string' && uuid.test(id) ? null : 'ID đối soát không hợp lệ.' })
  return id.toLowerCase()
}

function dateExists(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function integer(query, key, fallback, max, errors) {
  if (query[key] === undefined) return fallback
  const value = query[key]
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
    errors[key] = `Giá trị phải là số nguyên từ 1 đến ${max}.`
  return Number(value)
}

function rejectUnknown(query, allowed, errors) {
  for (const key of Object.keys(query))
    if (!allowed.includes(key)) errors[key] = 'Tham số không được hỗ trợ khi xem đối soát.'
}

export function validateSettlementListQuery(query = {}) {
  const errors = Object.create(null)
  rejectUnknown(query, ['search', 'status', 'from', 'to', 'page', 'limit'], errors)
  const page = integer(query, 'page', 1, 1_000_000, errors)
  const limit = integer(query, 'limit', 10, 50, errors)
  if (![10, 25, 50].includes(limit)) errors.limit = 'Số dòng mỗi trang phải là 10, 25 hoặc 50.'
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 150 || /[\u0000-\u001f\u007f]/.test(query.search)))
    errors.search = 'Từ khóa phải là chuỗi hợp lệ tối đa 150 ký tự.'
  if (query.status !== undefined && !statuses.includes(query.status)) errors.status = 'Trạng thái đối soát không hợp lệ.'
  for (const key of ['from', 'to'])
    if (query[key] !== undefined && !dateExists(query[key])) errors[key] = 'Ngày phải là YYYY-MM-DD tồn tại, năm từ 0001 đến 9999.'
  if (!errors.from && !errors.to && query.from && query.to && query.from > query.to)
    errors.to = 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.'
  requireValidBody(errors)
  return { search: query.search?.trim() ?? '', status: query.status ?? 'ALL', from: query.from, to: query.to, page, limit }
}

export function validateSettlementDetailQuery(query = {}) {
  const errors = Object.create(null)
  rejectUnknown(query, ['transactionsPage', 'transactionsLimit'], errors)
  const page = integer(query, 'transactionsPage', 1, 1_000_000, errors)
  const limit = integer(query, 'transactionsLimit', 10, 50, errors)
  if (![10, 25, 50].includes(limit)) errors.transactionsLimit = 'Số giao dịch mỗi trang phải là 10, 25 hoặc 50.'
  requireValidBody(errors)
  return { page, limit }
}
