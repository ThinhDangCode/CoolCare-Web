import { AppError, requireValidBody } from '../../utils.js'

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function validateVoucherBookingId(value) {
  if (!uuidPattern.test(String(value ?? '')))
    throw new AppError(400, 'INVALID_ID', 'Mã lịch dịch vụ không hợp lệ.')
  return value
}

export function validateVoucherCode(body = {}) {
  const code = String(body.code ?? '')
    .trim()
    .toUpperCase()
  requireValidBody({
    code: /^[A-Z0-9_-]{3,20}$/.test(code) ? null : 'Mã voucher không hợp lệ.',
  })
  return code
}

export function validateVoucherId(value) {
  if (!uuidPattern.test(value ?? '')) throw new AppError(422, 'INVALID_ID', 'ID không hợp lệ.')
  return value
}

export function validateVoucherListQuery(query, usages = false) {
  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? 10 : Number(query.limit)
  const status = query.status ?? 'ALL'
  const errors = {}
  if (!Number.isInteger(page) || page < 1) errors.page = 'Trang không hợp lệ.'
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    errors.limit = 'Số dòng phải từ 1 đến 100.'
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 150))
    errors.search = 'Từ khóa không hợp lệ.'
  if (
    usages &&
    query.voucher_search !== undefined &&
    (typeof query.voucher_search !== 'string' || query.voucher_search.length > 100)
  )
    errors.voucher_search = 'Mã voucher tìm kiếm không hợp lệ.'
  if (
    usages &&
    query.customer_search !== undefined &&
    (typeof query.customer_search !== 'string' || query.customer_search.length > 150)
  )
    errors.customer_search = 'Thông tin khách hàng tìm kiếm không hợp lệ.'
  const statuses = usages ? ['ALL', 'RESERVED', 'USED', 'RELEASED'] : ['ALL', 'ACTIVE', 'INACTIVE']
  if (!statuses.includes(status)) errors.status = 'Trạng thái không hợp lệ.'
  if (!usages && query.sort !== undefined && !['NEWEST', 'OLDEST'].includes(query.sort))
    errors.sort = 'Kiểu sắp xếp không hợp lệ.'
  if (usages && query.voucher_id && !uuidPattern.test(query.voucher_id))
    errors.voucher_id = 'Voucher không hợp lệ.'
  if (usages && query.period !== undefined && !['THIS_MONTH', 'ALL_TIME'].includes(query.period))
    errors.period = 'Khoảng thời gian không hợp lệ.'
  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  for (const key of ['from_date', 'to_date']) {
    if (
      usages &&
      query[key] !== undefined &&
      (!datePattern.test(query[key]) || Number.isNaN(Date.parse(`${query[key]}T00:00:00Z`)))
    )
      errors[key] = 'Ngày không hợp lệ.'
  }
  if (usages && query.from_date && query.to_date && query.from_date > query.to_date)
    errors.to_date = 'Ngày kết thúc phải từ ngày bắt đầu trở đi.'
  requireValidBody(errors)
  return {
    page,
    limit,
    search: query.search?.trim() ?? '',
    status,
    sort: usages ? undefined : (query.sort ?? 'NEWEST'),
    voucherId: query.voucher_id,
    voucherSearch: query.voucher_search?.trim() ?? '',
    customerSearch: query.customer_search?.trim() ?? '',
    period: usages ? (query.period ?? 'THIS_MONTH') : undefined,
    fromDate: query.from_date,
    toDate: query.to_date,
  }
}

export function validateVoucherInput(body, partial = false) {
  const allowed = [
    'code',
    'name',
    'discount_type',
    'discount_value',
    'minimum_order_amount',
    'maximum_discount',
    'usage_limit',
    'usage_limit_per_customer',
    'start_at',
    'end_at',
  ]
  const errors = {}
  const output = {}
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
  for (const key of Object.keys(body))
    if (!allowed.includes(key)) errors[key] = 'Trường không được hỗ trợ.'
  for (const key of ['code', 'name']) {
    if (body[key] === undefined) {
      if (!partial) errors[key] = 'Vui lòng nhập trường này.'
      continue
    }
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > 100)
      errors[key] = 'Không được trống hoặc vượt quá 100 ký tự.'
    else if (key === 'code' && !/^[A-Za-z0-9_-]{3,20}$/.test(body[key].trim()))
      errors.code = 'Mã phải có 3–20 ký tự gồm chữ, số, dấu gạch ngang hoặc gạch dưới.'
    else output[key] = key === 'code' ? body[key].trim().toUpperCase() : body[key].trim()
  }
  if (body.discount_type !== undefined) {
    if (!['PERCENTAGE', 'FIXED_AMOUNT'].includes(body.discount_type))
      errors.discount_type = 'Loại giảm giá không hợp lệ.'
    else output.discount_type = body.discount_type
  } else if (!partial) errors.discount_type = 'Vui lòng chọn loại giảm giá.'
  for (const key of [
    'discount_value',
    'minimum_order_amount',
    'maximum_discount',
    'usage_limit',
    'usage_limit_per_customer',
  ]) {
    if (body[key] !== undefined) {
      const value = body[key]
      const nullable = ['maximum_discount', 'usage_limit', 'usage_limit_per_customer'].includes(key)
      if (value === null && nullable) output[key] = null
      else if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < (['minimum_order_amount', 'maximum_discount'].includes(key) ? 0 : 1) ||
        !Number.isInteger(value)
      )
        errors[key] = 'Giá trị không hợp lệ.'
      else output[key] = value
    } else if (!partial && ['discount_value', 'minimum_order_amount'].includes(key))
      errors[key] = 'Vui lòng nhập trường này.'
  }
  for (const key of ['start_at', 'end_at']) {
    if (body[key] === undefined) {
      if (!partial) errors[key] = 'Vui lòng chọn thời gian.'
      continue
    }
    const date = new Date(body[key])
    if (Number.isNaN(date.getTime())) errors[key] = 'Thời gian không hợp lệ.'
    else output[key] = date.toISOString()
  }
  if (
    (output.discount_type ?? body.discount_type) === 'PERCENTAGE' &&
    output.discount_value !== undefined &&
    output.discount_value > 100
  )
    errors.discount_value = 'Phần trăm giảm không được vượt quá 100.'
  if (output.start_at && output.end_at && new Date(output.end_at) <= new Date(output.start_at))
    errors.end_at = 'Thời gian kết thúc phải sau thời gian bắt đầu.'
  if (
    output.usage_limit != null &&
    output.usage_limit_per_customer != null &&
    output.usage_limit_per_customer > output.usage_limit
  )
    errors.usage_limit_per_customer = 'Giới hạn mỗi khách không được vượt quá tổng lượt sử dụng.'
  if (partial && !Object.keys(output).length) errors.body = 'Không có dữ liệu cần cập nhật.'
  requireValidBody(errors)
  return output
}

export function validateVoucherStatus(body) {
  if (!body || Object.keys(body).length !== 1 || typeof body.is_active !== 'boolean')
    throw new AppError(422, 'VALIDATION_ERROR', 'Vui lòng gửi is_active dạng boolean.')
  return body.is_active
}
