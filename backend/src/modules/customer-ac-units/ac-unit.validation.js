import { AppError } from '../../utils.js'

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

const invalid = (field, message) =>
  new AppError(422, 'VALIDATION_ERROR', 'Tham số lịch sử máy lạnh không hợp lệ.', { [field]: message })

const single = (value, field) => {
  if (value === undefined) throw invalid(field, `${field} là bắt buộc.`)
  if (typeof value !== 'string') throw invalid(field, `${field} không hợp lệ.`)
  return value
}

// A device group is identified by brand + model. "none" stands for "not recorded".
const reference = (value, field) => {
  const text = single(value, field)
  if (text === 'none') return null
  if (!uuidPattern.test(text)) throw invalid(field, `${field} phải là UUID hoặc "none".`)
  return text
}

const integer = (value, field, fallback, max = null) => {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value)) throw invalid(field, `${field} phải là số nguyên dương.`)
  const parsed = Number(value)
  if (parsed < 1 || (max !== null && parsed > max)) {
    throw invalid(field, max === null ? `${field} phải là số nguyên dương.` : `${field} phải từ 1 đến ${max}.`)
  }
  return parsed
}

export function validateAcHistoryQuery(query = {}) {
  const unknown = Object.keys(query).filter((key) => !['brandId', 'modelId', 'page', 'limit'].includes(key))
  if (unknown.length) throw invalid('query', `Không hỗ trợ tham số: ${unknown.join(', ')}.`)
  const page = integer(query.page, 'page', 1, 100000)
  const limit = integer(query.limit, 'limit', 20, 50)
  return {
    brandId: reference(query.brandId, 'brandId'),
    modelId: reference(query.modelId, 'modelId'),
    page,
    limit,
    offset: (page - 1) * limit,
  }
}
