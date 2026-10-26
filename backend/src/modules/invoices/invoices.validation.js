import { requireValidBody } from '../../utils.js'

const allowed = new Set(['search', 'status', 'service', 'from', 'to', 'page', 'limit'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const statuses = ['ALL', 'PAID', 'UNRECORDED']

export function validateInvoiceId(id) {
  requireValidBody({ id: typeof id === 'string' && uuid.test(id) ? null : 'ID hóa đơn không hợp lệ.' })
  return id.toLowerCase()
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateInvoiceListQuery(query = {}) {
  const errors = Object.create(null)
  for (const key of Object.keys(query))
    if (!allowed.has(key)) errors[key] = 'Tham số không được hỗ trợ khi xem hóa đơn.'
  const integer = (key, fallback, max) => {
    if (query[key] === undefined) return fallback
    const value = query[key]
    if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
      errors[key] = `Giá trị phải là số nguyên từ 1 đến ${max}.`
    return Number(value)
  }
  const page = integer('page', 1, 1_000_000)
  const limit = integer('limit', 10, 50)
  if (![10, 25, 50].includes(limit)) errors.limit = 'Số dòng mỗi trang phải là 10, 25 hoặc 50.'
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 150 || /[\u0000-\u001f\u007f]/.test(query.search)))
    errors.search = 'Từ khóa phải là chuỗi hợp lệ tối đa 150 ký tự.'
  if (query.status !== undefined && !statuses.includes(query.status))
    errors.status = 'Tình trạng thanh toán hóa đơn không hợp lệ.'
  const service = query.service === undefined ? 'ALL' : query.service
  if (typeof service !== 'string' || (service !== 'ALL' && !uuid.test(service)))
    errors.service = 'Dịch vụ phải là ALL hoặc UUID dịch vụ.'
  for (const key of ['from', 'to'])
    if (query[key] !== undefined && !validDate(query[key]))
      errors[key] = 'Ngày phải là YYYY-MM-DD tồn tại, năm từ 0001 đến 9999.'
  if (!errors.from && !errors.to && query.from && query.to && query.from > query.to)
    errors.to = 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.'
  requireValidBody(errors)
  return {
    search: query.search?.trim() ?? '',
    status: query.status ?? 'ALL',
    service: service === 'ALL' ? service : service.toLowerCase(),
    from: query.from,
    to: query.to,
    page,
    limit,
  }
}
