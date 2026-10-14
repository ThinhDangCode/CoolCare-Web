import { requireValidBody } from '../../utils.js'

const methods = ['ALL', 'CASH', 'VNPAY', 'ZALOPAY', 'FREE']
const allowed = new Set(['from', 'to', 'method', 'search'])

function validExcelCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  if (year < 1900 || year > 9999) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateRevenueExportQuery(query = {}) {
  const errors = Object.create(null)
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) errors[key] = 'Tham số không được hỗ trợ khi xuất báo cáo.'
  }
  for (const key of ['from', 'to']) {
    if (!validExcelCalendarDate(query[key])) {
      errors[key] = 'Bắt buộc có ngày YYYY-MM-DD tồn tại, năm từ 1900 đến 9999.'
    }
  }
  if (!errors.from && !errors.to && query.from > query.to) {
    errors.to = 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.'
  }
  if (query.method !== undefined && !methods.includes(query.method)) {
    errors.method = 'Phương thức thanh toán không hợp lệ.'
  }
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 150)) {
    errors.search = 'Từ khóa phải là chuỗi tối đa 150 ký tự.'
  }
  requireValidBody(errors)
  return { from: query.from, to: query.to, method: query.method ?? 'ALL', search: query.search?.trim() ?? '' }
}
