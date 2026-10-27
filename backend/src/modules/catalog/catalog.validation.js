import { AppError, requireValidBody } from '../../utils.js'

export const acTypes = [
  'WALL_MOUNTED',
  'CEILING_CASSETTE',
  'CEILING_SUSPENDED',
  'FLOOR_STANDING',
  'DUCTED',
  'PORTABLE',
  'WINDOW',
]

export const resources = Object.freeze({
  skills: { table: 'skills', fields: ['name', 'service_id', 'is_active'] },
  categories: {
    table: 'service_categories',
    fields: ['name', 'description', 'image_url', 'is_active'],
  },
  brands: { table: 'ac_brands', fields: ['name', 'description', 'is_active'] },
  services: {
    table: 'services',
    fields: [
      'name',
      'description',
      'category_id',
      'base_price',
      'estimated_duration',
      'maintenance_interval_days',
      'is_active',
    ],
  },
  models: {
    table: 'ac_models',
    fields: [
      'model_name',
      'brand_id',
      'ac_type',
      'capacity_btu',
      'inverter',
      'description',
      'is_active',
    ],
  },
})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function validateId(id) {
  if (!uuid.test(id ?? '')) throw new AppError(422, 'INVALID_ID', 'ID không hợp lệ.')
  return id
}
export function validateInput(kind, body, partial = false) {
  const errors = {}
  const output = {}
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
  for (const key of Object.keys(body))
    if (!resources[kind].fields.includes(key)) errors[key] = 'Trường không được hỗ trợ.'
  for (const key of resources[kind].fields) {
    let value = body[key]
    if (value === undefined) {
      if (
        !partial &&
        [
          'name',
          'category_id',
          'service_id',
          'base_price',
          'model_name',
          'brand_id',
          'ac_type',
          'capacity_btu',
          'inverter',
        ].includes(key)
      )
        errors[key] = 'Vui lòng nhập trường này.'
      continue
    }
    if (key === 'name' || key === 'model_name') {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.trim().length > (kind === 'services' ? 150 : 100)
      )
        errors[key] = 'Tên không được trống hoặc vượt quá độ dài cho phép.'
      else if (key === 'model_name' && (!/[\p{L}0-9]/u.test(value) || !/^[\p{L}\p{M}0-9 &'’()./_-]+$/u.test(value.trim())))
        errors[key] = 'Use letters, numbers, spaces and standard model separators.'
      else if (key !== 'model_name' && (!/\p{L}/u.test(value) || !/^[\p{L}\p{M} &'’()./-]+$/u.test(value.trim())))
        errors[key] = 'Use letters and spaces; numbers and special symbols are not allowed.'
      else value = value.trim()
    } else if (key === 'description' || key === 'image_url') {
      if (
        value !== null &&
        (typeof value !== 'string' || value.length > (key === 'image_url' ? 2048 : 5000))
      )
        errors[key] = 'Nội dung không hợp lệ hoặc quá dài.'
      else value = value?.trim() || null
      if (key === 'image_url' && value && !/^https?:\/\//i.test(value))
        errors[key] = 'Nhập đường dẫn HTTP hoặc HTTPS.'
    } else if (key === 'category_id' || key === 'brand_id' || key === 'service_id') {
      if (typeof value !== 'string' || !uuid.test(value))
        errors[key] =
          key === 'brand_id'
            ? 'Vui lòng chọn hãng hợp lệ.'
            : key === 'service_id'
              ? 'Vui lòng chọn dịch vụ hợp lệ.'
              : 'Vui lòng chọn danh mục hợp lệ.'
    } else if (key === 'ac_type') {
      if (!acTypes.includes(value)) errors[key] = 'Vui lòng chọn loại máy hợp lệ.'
    } else if (key === 'capacity_btu') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 2147483647)
        errors[key] = 'BTU phải là số nguyên dương.'
    } else if (key === 'is_active' || key === 'inverter') {
      if (typeof value !== 'boolean')
        errors[key] =
          key === 'inverter' ? 'Inverter phải là boolean.' : 'Trạng thái phải là boolean.'
    } else if (key === 'base_price') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 9999999999.99 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 0.0001
      )
        errors[key] = 'Giá phải từ 0 đến 9.999.999.999,99, tối đa 2 chữ số thập phân.'
    } else if (
      value !== null &&
      (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 2147483647)
    )
      errors[key] = 'Nhập số nguyên dương hoặc để trống.'
    output[key] = value
  }
  if (partial && !Object.keys(output).length) errors.body = 'Không có dữ liệu cần cập nhật.'
  requireValidBody(errors)
  return output
}
export function validateQuery(query, kind) {
  const errors = {}
  if (query.trash !== undefined && !['true', 'false'].includes(query.trash)) errors.trash = 'Invalid trash filter.'
  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? 10 : Number(query.limit)
  if (!Number.isInteger(page) || page < 1 || page > 1000000) errors.page = 'Trang không hợp lệ.'
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    errors.limit = 'Số dòng phải từ 1 đến 100.'
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 150))
    errors.search = 'Từ khóa không hợp lệ.'
  if (query.status !== undefined && !['all', 'active', 'inactive'].includes(query.status))
    errors.status = 'Trạng thái không hợp lệ.'
  if (query.category_id !== undefined && !uuid.test(query.category_id))
    errors.category_id = 'Danh mục không hợp lệ.'
  const modelFilters = {}
  if (kind === 'skills') {
    if (
      query.service_id !== undefined &&
      (typeof query.service_id !== 'string' || !uuid.test(query.service_id))
    )
      errors.service_id = 'Choose a valid service.'
    if (query.sort !== undefined && !['newest', 'oldest', 'name'].includes(query.sort))
      errors.sort = 'Invalid sort order.'
    modelFilters.serviceId = query.service_id
    modelFilters.sort = query.sort ?? 'newest'
  }
  if (kind === 'models') {
    if (query.brand_id !== undefined) {
      if (typeof query.brand_id !== 'string' || !uuid.test(query.brand_id))
        errors.brand_id = 'Hãng không hợp lệ.'
      modelFilters.brandId = query.brand_id
    }
    if (query.ac_type !== undefined) {
      if (!acTypes.includes(query.ac_type)) errors.ac_type = 'Loại máy không hợp lệ.'
      modelFilters.acType = query.ac_type
    }
    if (query.capacity_btu !== undefined) {
      const btu = Number(query.capacity_btu)
      if (
        typeof query.capacity_btu !== 'string' ||
        !Number.isInteger(btu) ||
        btu <= 0 ||
        btu > 2147483647
      )
        errors.capacity_btu = 'BTU phải là số nguyên dương.'
      modelFilters.capacityBtu = btu
    }
    if (query.inverter !== undefined) {
      if (!['true', 'false'].includes(query.inverter))
        errors.inverter = 'Inverter phải là true hoặc false.'
      modelFilters.inverter = query.inverter === 'true'
    }
  }
  requireValidBody(errors)
  return {
    ...(query.trash !== undefined ? { trash: query.trash === 'true' } : {}),
    page,
    limit,
    search: query.search?.trim() ?? '',
    status: query.status ?? 'all',
    categoryId: query.category_id,
    ...modelFilters,
  }
}
