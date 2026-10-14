import { AppError, requireValidBody } from '../../utils.js'

// PostgreSQL accepts UUID values regardless of RFC version/variant bits. The
// deterministic demo IDs are MD5-derived UUIDs, so validate the database UUID
// shape instead of rejecting otherwise valid UUID columns from our own API.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const clean = (value, max) => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return null
  const result = value.trim().replace(/\s+/g, ' ')
  return result && result.length <= max ? result : null
}

const validDate = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

const validHttpsUrl = (value) => {
  if (typeof value !== 'string' || value.length > 2048) return false
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

export function validateSetAvailabilityStatus(body) {
  const allowed = ['status']
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  ) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu trạng thái chưa hợp lệ.')
  }
  if (!['ONLINE', 'OFFLINE'].includes(body.status)) {
    throw new AppError(
      422,
      'INVALID_AVAILABILITY_STATUS',
      'Trạng thái nhận việc chỉ có thể là ONLINE hoặc OFFLINE.',
      { status: 'Vui lòng chọn ONLINE hoặc OFFLINE.' },
    )
  }
  return { status: body.status }
}

export function validateCertificationId(value) {
  if (!uuidPattern.test(String(value ?? ''))) {
    throw new AppError(400, 'INVALID_CERTIFICATION_ID', 'Certification ID is invalid.')
  }
  return value
}

export function validateTechnicianSkillId(value) {
  if (!uuidPattern.test(String(value ?? ''))) {
    throw new AppError(400, 'INVALID_TECHNICIAN_SKILL_ID', 'Kỹ năng trong hồ sơ không hợp lệ.')
  }
  return value
}

export function validateTechnicianSkillSubmission(body) {
  const allowed = ['skill_id', 'ac_brand_id', 'skill_level']
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu kỹ năng chưa hợp lệ.')
  }
  const errors = {}
  if (!uuidPattern.test(String(body.skill_id ?? ''))) errors.skill_id = 'Vui lòng chọn kỹ năng hợp lệ.'
  const brandId = body.ac_brand_id ?? null
  if (brandId !== null && !uuidPattern.test(String(brandId))) errors.ac_brand_id = 'Vui lòng chọn thương hiệu hợp lệ.'
  if (!['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'].includes(body.skill_level)) {
    errors.skill_level = 'Cấp độ kỹ năng không hợp lệ.'
  }
  requireValidBody(errors)
  return { skill_id: body.skill_id, ac_brand_id: brandId, skill_level: body.skill_level }
}

export function validateCertificateNumber(value) {
  const certificateNumber = clean(value, 30)
  if (!certificateNumber) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Số chứng chỉ không hợp lệ.', {
      certificate_number: 'Số chứng chỉ là bắt buộc và không được vượt quá 30 ký tự.',
    })
  }
  return certificateNumber
}

export function validateCertificationIdentity(query) {
  const certificateName = clean(query?.name, 150)
  const issuedBy = clean(query?.issued_by, 150)
  const certificateNumber = validateCertificateNumber(query?.number)
  const errors = {}
  if (!certificateName) errors.certificate_name = 'Tên chứng chỉ là bắt buộc và không được vượt quá 150 ký tự.'
  if (!issuedBy) errors.issued_by = 'Đơn vị cấp là bắt buộc và không được vượt quá 150 ký tự.'
  requireValidBody(errors)
  return { certificate_name: certificateName, issued_by: issuedBy, certificate_number: certificateNumber }
}

export function validateCertificationSubmission(body) {
  const allowed = ['certificate_name', 'certificate_number', 'issued_by', 'issued_date', 'expiry_date', 'document_url']
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu chứng chỉ chưa hợp lệ.')
  }
  const result = {
    certificate_name: clean(body.certificate_name, 150),
    certificate_number: clean(body.certificate_number, 30),
    issued_by: clean(body.issued_by, 150),
    issued_date: body.issued_date ?? null,
    expiry_date: body.expiry_date ?? null,
    document_url: typeof body.document_url === 'string' ? body.document_url.trim() : '',
  }
  const errors = {}
  if (!result.certificate_name) errors.certificate_name = 'Tên chứng chỉ là bắt buộc và không được vượt quá 150 ký tự.'
  if (!result.certificate_number) errors.certificate_number = 'Số chứng chỉ là bắt buộc và không được vượt quá 30 ký tự.'
  if (!result.issued_by) errors.issued_by = 'Đơn vị cấp là bắt buộc và không được vượt quá 150 ký tự.'
  if (!validDate(result.issued_date)) errors.issued_date = 'Ngày cấp không hợp lệ.'
  if (result.expiry_date !== null && !validDate(result.expiry_date)) errors.expiry_date = 'Ngày hết hạn không hợp lệ.'
  if (result.issued_date && result.expiry_date && result.expiry_date < result.issued_date) errors.expiry_date = 'Ngày hết hạn phải sau hoặc bằng ngày cấp.'
  if (!validHttpsUrl(result.document_url)) errors.document_url = 'Tệp minh chứng phải là URL HTTPS hợp lệ.'
  requireValidBody(errors)
  return result
}
