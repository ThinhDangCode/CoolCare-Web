import { AppError } from '../../utils.js'

const integer = (value, field, fallback, max = null) => {
  if (value === undefined) return fallback
  if (Array.isArray(value) || typeof value === 'object') throw invalid(field, `${field} phải là số nguyên dương.`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (max !== null && parsed > max)) {
    throw invalid(field, max === null ? `${field} phải là số nguyên dương.` : `${field} phải từ 1 đến ${max}.`)
  }
  return parsed
}

const invalid = (field, message) => new AppError(
  422,
  'VALIDATION_ERROR',
  'Tham số lịch sử dịch vụ máy lạnh không hợp lệ.',
  { [field]: message },
)

export function validateAcServiceHistoryQuery(query = {}) {
  const unknown = Object.keys(query).filter((key) => !['page', 'limit'].includes(key))
  if (unknown.length) throw invalid('query', `Không hỗ trợ tham số: ${unknown.join(', ')}.`)
  const page = integer(query.page, 'page', 1)
  const limit = integer(query.limit, 'limit', 20, 50)
  const offset = (page - 1) * limit
  if (!Number.isSafeInteger(offset)) throw invalid('page', 'Trang yêu cầu vượt quá phạm vi hỗ trợ.')
  return { page, limit, offset }
}
