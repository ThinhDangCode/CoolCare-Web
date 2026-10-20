import { AppError, requireValidBody } from '../../utils.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const voucherFields = [
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
const blogFields = ['title', 'slug', 'thumbnail_url', 'content', 'status']

export function validateUuid(value) {
  if (!uuidPattern.test(value ?? '')) throw new AppError(422, 'INVALID_ID', 'ID không hợp lệ.')
  return value
}

export function validateManagementListQuery(query, resource) {
  const errors = {}
  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? 10 : Number(query.limit)
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000) errors.page = 'Trang không hợp lệ.'
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    errors.limit = 'Số dòng phải từ 1 đến 100.'
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 150))
    errors.search = 'Từ khóa không hợp lệ.'
  if (
    resource === 'usages' &&
    query.voucher_search !== undefined &&
    (typeof query.voucher_search !== 'string' || query.voucher_search.length > 100)
  )
    errors.voucher_search = 'Mã voucher tìm kiếm không hợp lệ.'
  if (
    resource === 'usages' &&
    query.customer_search !== undefined &&
    (typeof query.customer_search !== 'string' || query.customer_search.length > 150)
  )
    errors.customer_search = 'Thông tin khách hàng tìm kiếm không hợp lệ.'
  const statusOptions =
    resource === 'users'
      ? ['ALL', 'ACTIVE', 'LOCKED', 'INACTIVE']
      : resource === 'vouchers'
        ? ['ALL', 'ACTIVE', 'INACTIVE']
        : resource === 'blogs'
          ? ['ALL', 'DRAFT', 'PUBLISHED', 'HIDDEN']
          : resource === 'complaints'
            ? ['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED']
            : ['ALL', 'RESERVED', 'USED', 'RELEASED']
  if (query.status !== undefined && !statusOptions.includes(query.status))
    errors.status = 'Trạng thái không hợp lệ.'
  if (
    resource === 'users' &&
    query.role !== undefined &&
    !['ALL', 'ADMIN', 'CUSTOMER', 'TECHNICIAN'].includes(query.role)
  )
    errors.role = 'Vai trò không hợp lệ.'
  if (
    resource === 'vouchers' &&
    query.sort !== undefined &&
    !['NEWEST', 'OLDEST'].includes(query.sort)
  )
    errors.sort = 'Kiểu sắp xếp không hợp lệ.'
  if (
    resource === 'blogs' &&
    query.sort !== undefined &&
    !['NEWEST', 'OLDEST'].includes(query.sort)
  )
    errors.sort = 'Kiểu sắp xếp không hợp lệ.'
  if (
    resource === 'complaints' &&
    query.type !== undefined &&
    !['ALL', 'SERVICE', 'TECHNICIAN', 'PAYMENT', 'OTHER'].includes(query.type)
  )
    errors.type = 'Loại khiếu nại không hợp lệ.'
  if (
    resource === 'usages' &&
    query.voucher_id !== undefined &&
    !uuidPattern.test(query.voucher_id)
  )
    errors.voucher_id = 'Voucher không hợp lệ.'
  if (
    resource === 'usages' &&
    query.period !== undefined &&
    !['THIS_MONTH', 'ALL_TIME'].includes(query.period)
  )
    errors.period = 'Khoảng thời gian không hợp lệ.'
  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  if (
    resource === 'usages' &&
    query.from_date !== undefined &&
    (!datePattern.test(query.from_date) || Number.isNaN(Date.parse(`${query.from_date}T00:00:00Z`)))
  )
    errors.from_date = 'Ngày bắt đầu không hợp lệ.'
  if (
    resource === 'usages' &&
    query.to_date !== undefined &&
    (!datePattern.test(query.to_date) || Number.isNaN(Date.parse(`${query.to_date}T00:00:00Z`)))
  )
    errors.to_date = 'Ngày kết thúc không hợp lệ.'
  if (resource === 'usages' && query.from_date && query.to_date && query.from_date > query.to_date)
    errors.to_date = 'Ngày kết thúc phải từ ngày bắt đầu trở đi.'
  requireValidBody(errors)
  return {
    page,
    limit,
    search: query.search?.trim() ?? '',
    voucherSearch: query.voucher_search?.trim() ?? '',
    customerSearch: query.customer_search?.trim() ?? '',
    status: query.status ?? 'ALL',
    role: query.role ?? 'ALL',
    ...(resource === 'complaints' ? { type: query.type ?? 'ALL' } : {}),
    voucherId: query.voucher_id,
    sort: ['vouchers', 'blogs'].includes(resource) ? (query.sort ?? 'NEWEST') : undefined,
    period: resource === 'usages' ? (query.period ?? 'THIS_MONTH') : undefined,
    fromDate: resource === 'usages' ? query.from_date : undefined,
    toDate: resource === 'usages' ? query.to_date : undefined,
  }
}

export function validateBlogInput(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu bài viết không hợp lệ.')
  const errors = {}
  const output = {}
  for (const key of Object.keys(body))
    if (!blogFields.includes(key)) errors[key] = 'Trường không được hỗ trợ.'
  const limits = { title: 200, slug: 200, content: 50000 }
  for (const key of ['title', 'slug', 'content']) {
    if (body[key] === undefined) {
      if (!partial) errors[key] = 'Vui lòng nhập trường này.'
      continue
    }
    if (typeof body[key] !== 'string' || !body[key].trim())
      errors[key] = 'Vui lòng nhập trường này.'
    else if (body[key].trim().length > limits[key])
      errors[key] = `Không được vượt quá ${limits[key]} ký tự.`
    else if (key === 'slug' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body[key].trim()))
      errors.slug = 'Slug chỉ gồm chữ thường, số và dấu gạch ngang.'
    else output[key] = body[key].trim()
  }
  if (body.thumbnail_url !== undefined) {
    if (body.thumbnail_url === null || body.thumbnail_url === '') output.thumbnail_url = null
    else {
      try {
        const url = new URL(body.thumbnail_url)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
        output.thumbnail_url = url.toString()
      } catch {
        errors.thumbnail_url = 'URL ảnh không hợp lệ.'
      }
    }
  }
  if (body.status !== undefined) {
    if (!['DRAFT', 'PUBLISHED', 'HIDDEN'].includes(body.status))
      errors.status = 'Trạng thái không hợp lệ.'
    else output.status = body.status
  } else if (!partial) output.status = 'DRAFT'
  if (partial && !Object.keys(output).length) errors.body = 'Không có dữ liệu cần cập nhật.'
  requireValidBody(errors)
  return output
}

export function validateBlogStatus(body) {
  if (
    !body ||
    Object.keys(body).length !== 1 ||
    !['DRAFT', 'PUBLISHED', 'HIDDEN'].includes(body.status)
  )
    throw new AppError(422, 'VALIDATION_ERROR', 'Trạng thái bài viết không hợp lệ.', {
      status: 'Chọn Draft, Published hoặc Hidden.',
    })
  return body.status
}

export function validateComplaintResolution(body) {
  const errors = {}
  const status = body?.status
  const resolution = typeof body?.resolution === 'string' ? body.resolution.trim() : ''
  const isDraft = body?.is_draft === true
  if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED'].includes(status))
    errors.status = 'Trạng thái xử lý không hợp lệ.'
  if (!resolution || resolution.length > 5000 || (!isDraft && resolution.length < 10))
    errors.resolution = isDraft
      ? 'Bản nháp phải có nội dung và không vượt quá 5.000 ký tự.'
      : 'Nội dung xử lý phải từ 10 đến 5.000 ký tự.'
  if (
    !body ||
    Object.keys(body).some(
      (key) => !['status', 'resolution', 'notify_customer', 'is_draft', 'penalty_points', 'penalty_expires_at'].includes(key)
    )
  )
    errors.body = 'Dữ liệu không hợp lệ.'
  if (body?.notify_customer !== undefined && typeof body.notify_customer !== 'boolean')
    errors.notify_customer = 'Tùy chọn thông báo khách hàng không hợp lệ.'
  if (body?.is_draft !== undefined && typeof body.is_draft !== 'boolean')
    errors.is_draft = 'Trạng thái bản nháp không hợp lệ.'
  if (body?.penalty_points !== undefined && (
    !Number.isInteger(body.penalty_points) || body.penalty_points < 1 || body.penalty_points > 12
  )) errors.penalty_points = 'Penalty points must be a whole number from 1 to 12.'
  if (body?.penalty_points !== undefined && (status !== 'RESOLVED' || isDraft))
    errors.penalty_points = 'Penalty points are only allowed when accepting a complaint.'
  if (body?.penalty_expires_at !== undefined && (
    typeof body.penalty_expires_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(body.penalty_expires_at) ||
    !Number.isFinite(Date.parse(body.penalty_expires_at)) ||
    Date.parse(body.penalty_expires_at) <= Date.now() || status !== 'RESOLVED' || isDraft
  )) errors.penalty_expires_at = 'Choose a future penalty expiry date and time when accepting a complaint.'
  requireValidBody(errors)
  return {
    status,
    resolution,
    ...(body.notify_customer !== undefined ? { notify_customer: body.notify_customer } : {}),
    ...(body.is_draft !== undefined ? { is_draft: body.is_draft } : {}),
    ...(body.penalty_points !== undefined ? { penalty_points: body.penalty_points } : {}),
    ...(body.penalty_expires_at !== undefined ? { penalty_expires_at: body.penalty_expires_at } : {}),
  }
}

export function validateUserStatus(body) {
  if (!body || Object.keys(body).length !== 1 || !['ACTIVE', 'LOCKED'].includes(body.status))
    throw new AppError(422, 'VALIDATION_ERROR', 'Trạng thái phải là ACTIVE hoặc LOCKED.', {
      status: 'Trạng thái không hợp lệ.',
    })
  return body.status
}

function validateNumber(
  value,
  key,
  errors,
  { required = false, nullable = false, integer = false, min = 0 } = {}
) {
  if (value === undefined) {
    if (required) errors[key] = 'Vui lòng nhập trường này.'
    return undefined
  }
  if (value === null && nullable) return null
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < min
  )
    errors[key] = 'Giá trị không hợp lệ.'
  return value
}

export function validateVoucherInput(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
  const errors = {}
  const output = {}
  for (const key of Object.keys(body))
    if (!voucherFields.includes(key)) errors[key] = 'Trường không được hỗ trợ.'
  for (const key of ['code', 'name']) {
    if (body[key] === undefined) {
      if (!partial) errors[key] = 'Vui lòng nhập trường này.'
      continue
    }
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > 100)
      errors[key] = 'Không được trống hoặc vượt quá 100 ký tự.'
    else if (key === 'code' && !/^[A-Za-z0-9_-]+$/.test(body[key].trim()))
      errors[key] = 'Mã chỉ được chứa chữ, số, dấu gạch ngang hoặc gạch dưới.'
    else output[key] = key === 'code' ? body[key].trim().toUpperCase() : body[key].trim()
  }
  if (body.discount_type === undefined) {
    if (!partial) errors.discount_type = 'Vui lòng chọn loại giảm giá.'
  } else if (!['PERCENTAGE', 'FIXED_AMOUNT'].includes(body.discount_type))
    errors.discount_type = 'Loại giảm giá không hợp lệ.'
  else output.discount_type = body.discount_type
  const numericFields = {
    discount_value: { required: !partial, integer: true, min: 1 },
    minimum_order_amount: { required: !partial, integer: true, min: 0 },
    maximum_discount: { nullable: true, integer: true, min: 0 },
    usage_limit: { nullable: true, integer: true, min: 1 },
    usage_limit_per_customer: { nullable: true, integer: true, min: 1 },
  }
  for (const [key, options] of Object.entries(numericFields)) {
    const value = validateNumber(body[key], key, errors, options)
    if (value !== undefined) output[key] = value
  }
  for (const key of ['start_at', 'end_at']) {
    if (body[key] === undefined) {
      if (!partial) errors[key] = 'Vui lòng chọn thời gian.'
      continue
    }
    const date = new Date(body[key])
    if (typeof body[key] !== 'string' || Number.isNaN(date.getTime()))
      errors[key] = 'Thời gian không hợp lệ.'
    else output[key] = date.toISOString()
  }
  if (
    (output.discount_type ?? body.discount_type) === 'PERCENTAGE' &&
    output.discount_value !== undefined
  ) {
    if (output.discount_value > 100)
      errors.discount_value = 'Phần trăm giảm không được vượt quá 100.'
    else if (!Number.isInteger(output.discount_value))
      errors.discount_value = 'Phần trăm giảm phải là số nguyên từ 1 đến 100.'
  }
  if (output.start_at && output.end_at && new Date(output.end_at) <= new Date(output.start_at))
    errors.end_at = 'Thời gian kết thúc phải sau thời gian bắt đầu.'
  if (
    output.usage_limit !== undefined &&
    output.usage_limit !== null &&
    output.usage_limit_per_customer !== undefined &&
    output.usage_limit_per_customer !== null &&
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
