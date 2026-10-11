import { requireValidBody } from '../../utils.js'

const statuses = ['ALL', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED']
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateWithdrawalId(id) {
  requireValidBody({
    id: typeof id === 'string' && uuid.test(id) ? null : 'ID yêu cầu rút tiền không hợp lệ.',
  })
  return id
}

export function validateWithdrawalListQuery(query = {}) {
  const errors = {}
  const integer = (key, fallback, max) => {
    const value = query[key]
    if (value === undefined) return fallback
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
    errors.status = 'Trạng thái yêu cầu rút tiền không hợp lệ.'
  }
  if (
    query.technician_id !== undefined &&
    (typeof query.technician_id !== 'string' || !uuid.test(query.technician_id))
  ) {
    errors.technician_id = 'ID kỹ thuật viên không hợp lệ.'
  }
  for (const key of ['from_date', 'to_date']) {
    if (query[key] !== undefined && !validDate(query[key]))
      errors[key] = 'Ngày phải có định dạng YYYY-MM-DD và tồn tại.'
  }
  if (
    !errors.from_date &&
    !errors.to_date &&
    query.from_date &&
    query.to_date &&
    query.from_date > query.to_date
  ) {
    errors.to_date = 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.'
  }
  requireValidBody(errors)
  return {
    page,
    limit,
    search: query.search?.trim() ?? '',
    status: query.status ?? 'ALL',
    technicianId: query.technician_id,
    fromDate: query.from_date,
    toDate: query.to_date,
  }
}
