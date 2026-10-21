import { requireValidBody } from '../../utils.js'

export const REPORTS_TIME_ZONE = 'Asia/Ho_Chi_Minh'
export const REPORTS_MAX_DAYS = 366
const dayMilliseconds = 86_400_000

function realDate(value) {
  if (typeof value !== 'string' || !/^(?:19|[2-9]\d)\d{2}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function validateReportsQuery(query = {}, now = new Date()) {
  const errors = Object.create(null)
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    requireValidBody({ query: 'Tham số báo cáo không hợp lệ.' })
  }
  for (const key of Object.keys(query)) {
    if (key !== 'from' && key !== 'to') errors[key] = 'Tham số không được hỗ trợ cho báo cáo.'
  }
  let { from, to } = query
  if (from === undefined && to === undefined) {
    to = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    from = new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * dayMilliseconds)
      .toISOString().slice(0, 10)
  }
  if (!realDate(from)) errors.from = 'Ngày bắt đầu phải là ngày hợp lệ theo YYYY-MM-DD, năm 1900–9999.'
  if (!realDate(to)) errors.to = 'Ngày kết thúc phải là ngày hợp lệ theo YYYY-MM-DD, năm 1900–9999.'
  let days = 0
  if (realDate(from) && realDate(to)) {
    days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / dayMilliseconds + 1
    if (days < 1) errors.to = 'Ngày kết thúc phải từ ngày bắt đầu trở đi.'
    if (days > REPORTS_MAX_DAYS) errors.to = `Khoảng báo cáo tối đa ${REPORTS_MAX_DAYS} ngày, tính cả hai ngày.`
  }
  requireValidBody(errors)
  return { from, to, timeZone: REPORTS_TIME_ZONE, granularity: days <= 90 ? 'day' : 'month' }
}
