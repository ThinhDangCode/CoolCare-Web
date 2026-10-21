import { requireValidBody } from '../../utils.js'
import { validateReportsQuery } from '../reports/reports.validation.js'

export function validateTechnicianStatisticsQuery(query = {}, now = new Date()) {
  const errors = Object.create(null)
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    requireValidBody({ query: 'Tham số thống kê kỹ thuật viên không hợp lệ.' })
  }
  for (const key of Object.keys(query)) {
    if (!['from', 'to', 'search', 'page', 'limit'].includes(key)) errors[key] = 'Tham số không được hỗ trợ.'
  }
  let search = ''
  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.length > 150 || /[\u0000-\u001f\u007f]/.test(query.search)) {
      errors.search = 'Từ khóa phải là văn bản tối đa 150 ký tự và không chứa ký tự điều khiển.'
    } else search = query.search.trim()
  }
  const page = query.page === undefined ? 1 : Number(query.page)
  if (query.page !== undefined && (typeof query.page !== 'string' || !/^[1-9]\d*$/.test(query.page) || !Number.isSafeInteger(page) || page > 1_000_000)) {
    errors.page = 'Trang phải là số nguyên từ 1 đến 1000000.'
  }
  const limit = query.limit === undefined ? 10 : Number(query.limit)
  if (query.limit !== undefined && (typeof query.limit !== 'string' || !['10', '20', '50'].includes(query.limit))) {
    errors.limit = 'Số dòng mỗi trang phải là 10, 20 hoặc 50.'
  }
  requireValidBody(errors)
  const period = validateReportsQuery({ ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }) }, now)
  return { ...period, search, page, limit }
}
