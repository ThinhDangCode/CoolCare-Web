import { AppError } from '../../utils.js'

export const VIEW_JOB_REQUEST_STATUSES = [
  'SELECTED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'COMPLETED',
  'CANCELLED',
]
export const VIEW_JOB_REQUEST_FILTERS = [...VIEW_JOB_REQUEST_STATUSES, 'HISTORY']

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function positiveInteger(value, field, fallback, maximum = null) {
  if (value === undefined) return fallback
  if (Array.isArray(value) || typeof value === 'object') {
    throw new AppError(422, 'VALIDATION_ERROR', 'Tham số danh sách yêu cầu công việc không hợp lệ.', {
      [field]: `${field} phải là số nguyên dương.`,
    })
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum !== null && parsed > maximum)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Tham số danh sách yêu cầu công việc không hợp lệ.', {
      [field]: maximum === null
        ? `${field} phải là số nguyên dương.`
        : `${field} phải từ 1 đến ${maximum}.`,
    })
  }
  return parsed
}

export function validateViewJobRequestsQuery(query = {}) {
  const allowed = ['status', 'page', 'limit']
  const unknown = Object.keys(query).filter((key) => !allowed.includes(key))
  if (unknown.length) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Tham số danh sách yêu cầu công việc không hợp lệ.', {
      query: `Không hỗ trợ tham số: ${unknown.join(', ')}.`,
    })
  }

  const rawStatus = query.status ?? 'SELECTED'
  if (
    Array.isArray(rawStatus) ||
    typeof rawStatus !== 'string' ||
    ![...VIEW_JOB_REQUEST_FILTERS, 'ALL'].includes(rawStatus)
  ) {
    throw new AppError(422, 'INVALID_JOB_REQUEST_STATUS', 'Trạng thái yêu cầu công việc không hợp lệ.', {
      status: `Trạng thái phải là ALL, HISTORY hoặc một trong: ${VIEW_JOB_REQUEST_STATUSES.join(', ')}.`,
    })
  }

  const page = positiveInteger(query.page, 'page', DEFAULT_PAGE)
  const limit = positiveInteger(query.limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT)
  const offset = (page - 1) * limit
  if (!Number.isSafeInteger(offset)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Vị trí phân trang quá lớn.', {
      page: 'Trang yêu cầu vượt quá phạm vi hỗ trợ.',
    })
  }

  return {
    status: rawStatus === 'ALL' ? null : rawStatus,
    page,
    limit,
    offset,
  }
}
