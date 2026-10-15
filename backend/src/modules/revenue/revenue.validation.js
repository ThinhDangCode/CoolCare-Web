import { requireValidBody } from '../../utils.js'
import { REVENUE_TIME_ZONE, SERVICE_BUCKETS } from './revenue.constants.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const allowed = new Set(['period', 'year', 'month', 'quarter', 'service', 'area'])
const types = ['MONTH', 'QUARTER', 'YEAR']
export function calendarMonthDays(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
function calendarDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function range(year, startMonth, monthCount) {
  const endMonth = startMonth + monthCount - 1
  return {
    from: calendarDate(year, startMonth, 1),
    to: calendarDate(year, endMonth, calendarMonthDays(year, endMonth)),
  }
}

export function validateRevenueQuery(query = {}) {
  const errors = Object.create(null)
  for (const key of Object.keys(query))
    if (!allowed.has(key)) errors[key] = 'Tham số không được hỗ trợ cho báo cáo doanh thu.'
  const type = query.period ?? 'MONTH'
  if (!types.includes(type)) errors.period = 'Kỳ báo cáo phải là MONTH, QUARTER hoặc YEAR.'
  const integer = (key, min, max) => {
    const value = query[key]
    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      Number(value) < min ||
      Number(value) > max
    ) {
      errors[key] = `Giá trị phải là số nguyên từ ${min} đến ${max}.`
    }
    return Number(value)
  }
  const year = integer('year', 1900, 9999)
  let month = null
  let quarter = null
  if (type === 'MONTH') month = integer('month', 1, 12)
  else if (query.month !== undefined) errors.month = 'Tháng chỉ được dùng với kỳ MONTH.'
  if (type === 'QUARTER') quarter = integer('quarter', 1, 4)
  else if (query.quarter !== undefined) errors.quarter = 'Quý chỉ được dùng với kỳ QUARTER.'
  const service = query.service ?? 'ALL'
  if (
    typeof service !== 'string' ||
    !(service === 'ALL' || Object.hasOwn(SERVICE_BUCKETS, service) || uuid.test(service))
  ) {
    errors.service = 'ID dịch vụ không hợp lệ.'
  }
  const area = query.area ?? 'ALL'
  if (
    typeof area !== 'string' ||
    area.length > 100 ||
    !area.trim() ||
    /[\u0000-\u001f\u007f]/.test(area)
  )
    errors.area = 'Khu vực phải là chuỗi hợp lệ tối đa 100 ký tự.'
  requireValidBody(errors)
  const monthCount = type === 'MONTH' ? 1 : type === 'QUARTER' ? 3 : 12
  const startMonth = month ?? (quarter ? (quarter - 1) * 3 + 1 : 1)
  let previousYear = year
  let previousMonth = startMonth - monthCount
  if (previousMonth < 1) {
    previousMonth += 12
    previousYear -= 1
  }
  const current = range(year, startMonth, monthCount)
  const previous = range(previousYear, previousMonth, monthCount)
  return {
    period: {
      type,
      year,
      month,
      quarter,
      ...current,
      previousFrom: previous.from,
      previousTo: previous.to,
      monthCount,
      timeZone: REVENUE_TIME_ZONE,
    },
    filters: {
      service: uuid.test(service) ? service.toLowerCase() : service,
      area: area.trim().replace(/\s+/gu, ' '),
    },
  }
}
