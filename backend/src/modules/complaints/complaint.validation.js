import { AppError, requireValidBody } from '../../utils.js'

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function validateComplaintId(value) {
  if (!uuidPattern.test(value ?? '')) throw new AppError(422, 'INVALID_ID', 'ID không hợp lệ.')
  return value
}

export function validateComplaintListQuery(query) {
  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? 10 : Number(query.limit)
  const status = query.status ?? 'ALL'
  const type = query.type ?? 'ALL'
  const sortBy = query.sort_by ?? 'created_at'
  const sortOrder = query.sort_order ?? 'desc'
  const errors = {}
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000) errors.page = 'Trang không hợp lệ.'
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    errors.limit = 'Số dòng phải từ 1 đến 100.'
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 150))
    errors.search = 'Từ khóa không hợp lệ.'
  if (!['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED'].includes(status))
    errors.status = 'Trạng thái không hợp lệ.'
  if (!['ALL', 'SERVICE', 'TECHNICIAN', 'PAYMENT', 'OTHER'].includes(type))
    errors.type = 'Loại khiếu nại không hợp lệ.'
  if (!['created_at', 'customer_name'].includes(sortBy))
    errors.sort_by = 'Cột sắp xếp không hợp lệ.'
  if (!['asc', 'desc'].includes(sortOrder)) errors.sort_order = 'Thứ tự sắp xếp không hợp lệ.'
  requireValidBody(errors)
  return {
    page,
    limit,
    search: query.search?.trim() ?? '',
    status,
    type,
    sortBy,
    sortOrder,
  }
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
      (key) => !['status', 'resolution', 'notify_customer', 'is_draft'].includes(key)
    )
  )
    errors.body = 'Dữ liệu không hợp lệ.'
  if (body?.notify_customer !== undefined && typeof body.notify_customer !== 'boolean')
    errors.notify_customer = 'Tùy chọn thông báo khách hàng không hợp lệ.'
  if (body?.is_draft !== undefined && typeof body.is_draft !== 'boolean')
    errors.is_draft = 'Trạng thái bản nháp không hợp lệ.'
  requireValidBody(errors)
  return {
    status,
    resolution,
    ...(body.notify_customer !== undefined ? { notify_customer: body.notify_customer } : {}),
    ...(body.is_draft !== undefined ? { is_draft: body.is_draft } : {}),
  }
}

export function validateCompensationVoucher(body = {}) {
  const discountValue = Number(body.discount_value)
  const minimumOrderAmount = Number(body.minimum_order_amount ?? 0)
  const validDays = Number(body.valid_days ?? 30)
  const notifyCustomer = body.notify_customer ?? true
  const errors = {}
  if (!Number.isInteger(discountValue) || discountValue < 1 || discountValue > 10_000_000)
    errors.discount_value = 'Số tiền bồi thường phải từ 1 đến 10.000.000 đồng.'
  if (!Number.isInteger(minimumOrderAmount) || minimumOrderAmount < 0)
    errors.minimum_order_amount = 'Giá trị đơn tối thiểu không hợp lệ.'
  if (!Number.isInteger(validDays) || validDays < 1 || validDays > 365)
    errors.valid_days = 'Thời hạn voucher phải từ 1 đến 365 ngày.'
  if (typeof notifyCustomer !== 'boolean')
    errors.notify_customer = 'Tùy chọn gửi thông báo không hợp lệ.'
  requireValidBody(errors)
  return {
    discount_value: discountValue,
    minimum_order_amount: minimumOrderAmount,
    valid_days: validDays,
    notify_customer: notifyCustomer,
  }
}
