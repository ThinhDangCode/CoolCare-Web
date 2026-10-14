import { AppError, requireValidBody } from '../../utils.js'

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function validateBlogId(value) {
  if (!uuidPattern.test(String(value ?? '')))
    throw new AppError(400, 'INVALID_ID', 'Mã bài viết không hợp lệ.')
  return value
}

export function validatePublishedBlogQuery(query) {
  const page = Number(query.page ?? 1)
  const limit = Number(query.limit ?? 10)
  const search = String(query.search ?? '').trim()
  requireValidBody({
    page: Number.isInteger(page) && page >= 1 ? null : 'Trang phải là số nguyên dương.',
    limit:
      Number.isInteger(limit) && limit >= 1 && limit <= 50
        ? null
        : 'Số phần tử mỗi trang phải từ 1 đến 50.',
    search: search.length <= 100 ? null : 'Từ khóa không được vượt quá 100 ký tự.',
  })
  return { page, limit, search }
}

export function validateAdminBlogQuery(query) {
  const page = Number(query.page ?? 1)
  const limit = Number(query.limit ?? 10)
  const search = String(query.search ?? '').trim()
  const status = query.status ?? 'ALL'
  const sort = query.sort ?? 'NEWEST'
  requireValidBody({
    page: Number.isInteger(page) && page >= 1 ? null : 'Trang phải là số nguyên dương.',
    limit:
      Number.isInteger(limit) && limit >= 1 && limit <= 100
        ? null
        : 'Số phần tử mỗi trang phải từ 1 đến 100.',
    search: search.length <= 150 ? null : 'Từ khóa không hợp lệ.',
    status: ['ALL', 'DRAFT', 'PUBLISHED', 'HIDDEN'].includes(status)
      ? null
      : 'Trạng thái không hợp lệ.',
    sort: ['NEWEST', 'OLDEST'].includes(sort) ? null : 'Kiểu sắp xếp không hợp lệ.',
  })
  return { page, limit, search, status, sort }
}

export function validateBlogInput(body, partial = false) {
  const fields = ['title', 'slug', 'thumbnail_url', 'content', 'status']
  const errors = {}
  const output = {}
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu bài viết không hợp lệ.')
  for (const key of Object.keys(body))
    if (!fields.includes(key)) errors[key] = 'Trường không được hỗ trợ.'
  const limits = { title: 200, slug: 200, content: 50000 }
  const minimums = { title: 5, slug: 1, content: 20 }
  for (const key of ['title', 'slug', 'content']) {
    if (body[key] === undefined) {
      if (!partial) errors[key] = 'Vui lòng nhập trường này.'
      continue
    }
    if (typeof body[key] !== 'string' || !body[key].trim())
      errors[key] = 'Vui lòng nhập trường này.'
    else if (body[key].trim().length < minimums[key])
      errors[key] = `Phải có ít nhất ${minimums[key]} ký tự.`
    else if (body[key].trim().length > limits[key])
      errors[key] = `Không được vượt quá ${limits[key]} ký tự.`
    else if (key === 'slug' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body[key].trim()))
      errors.slug = 'Slug chỉ gồm chữ thường, số và dấu gạch ngang.'
    else output[key] = body[key].trim()
  }
  if (body.thumbnail_url !== undefined) {
    if (body.thumbnail_url === null || body.thumbnail_url === '') output.thumbnail_url = null
    else if (typeof body.thumbnail_url !== 'string' || body.thumbnail_url.trim().length > 2048) {
      errors.thumbnail_url = 'URL ảnh không hợp lệ hoặc vượt quá 2.048 ký tự.'
    } else {
      try {
        const url = new URL(body.thumbnail_url.trim())
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
    throw new AppError(422, 'VALIDATION_ERROR', 'Trạng thái bài viết không hợp lệ.')
  return body.status
}
