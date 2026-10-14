export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function asyncHandler(handler) {
  return function wrappedHandler(request, response, next) {
    Promise.resolve(handler(request, response, next)).catch(next)
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const phonePattern = /^(?:0|\+84)(?:3[2-9]|5[25689]|7[06789]|8[1-689]|9[0-46-9])\d{7}$/
const fullNamePattern =
  /^[A-Za-zÀ-ÖØ-öø-ỹĐđ\u0300-\u036f]+(?:[ '\-][A-Za-zÀ-ÖØ-öø-ỹĐđ\u0300-\u036f]+)*$/u

export function normalizeEmail(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export function normalizePhone(value) {
  return String(value ?? '').replace(/[\s.-]/g, '')
}

export function normalizeFullName(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

export function isValidFullName(value) {
  return fullNamePattern.test(normalizeFullName(value))
}

export function isValidEmail(value) {
  return emailPattern.test(normalizeEmail(value))
}

export function isValidVietnamesePhone(value) {
  const normalized = normalizePhone(value)
  const localPhone = normalized.startsWith('+84') ? `0${normalized.slice(3)}` : normalized
  return phonePattern.test(normalized) && !/^0(\d)\1{8}$/.test(localPhone)
}

export function isStrongPassword(value) {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 72 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  )
}

export function requireValidBody(details) {
  const errors = Object.fromEntries(
    Object.entries(details).filter(([, message]) => Boolean(message))
  )
  if (Object.keys(errors).length > 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu gửi lên chưa hợp lệ.', errors)
  }
}

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function validateUuid(value) {
  if (!uuidPattern.test(value ?? '')) {
    throw new AppError(422, 'INVALID_ID', 'ID không hợp lệ.')
  }
  return value
}
