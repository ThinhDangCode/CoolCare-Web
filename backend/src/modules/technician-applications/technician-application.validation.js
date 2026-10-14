import { AppError, requireValidBody } from '../../utils.js'
import { validateTechnicianAreas, validateTechnicianSkills } from '../technicians/technician.validation.js'

const qualificationLevels = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']

function assertObject(value, allowedFields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowedFields.includes(key))
  ) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu gửi lên chưa hợp lệ.')
  }
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned.length <= maxLength ? cleaned : null
}

function cleanOptionalText(value, maxLength) {
  if (value === undefined || value === null || value === '') return null
  return cleanText(value, maxLength)
}

function validHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function validateCertification(item, index) {
  assertObject(item, [
    'certificate_name',
    'certificate_number',
    'issued_by',
    'issued_date',
    'expiry_date',
    'document_url',
  ])
  const errors = {}
  const certificateName = cleanText(item.certificate_name, 150)
  const certificateNumber = cleanOptionalText(item.certificate_number, 30)
  const issuedBy = cleanOptionalText(item.issued_by, 150)
  const issuedDate = item.issued_date ?? null
  const expiryDate = item.expiry_date ?? null

  if (!certificateName) errors[`certifications.${index}.certificate_name`] = 'Tên chứng chỉ là bắt buộc và không được vượt quá 150 ký tự.'
  if (item.certificate_number && certificateNumber === null) errors[`certifications.${index}.certificate_number`] = 'Số chứng chỉ không được vượt quá 30 ký tự.'
  if (item.issued_by && issuedBy === null) errors[`certifications.${index}.issued_by`] = 'Đơn vị cấp không được vượt quá 150 ký tự.'
  if (issuedDate !== null && !validDate(issuedDate)) errors[`certifications.${index}.issued_date`] = 'Ngày cấp không hợp lệ.'
  if (expiryDate !== null && !validDate(expiryDate)) errors[`certifications.${index}.expiry_date`] = 'Ngày hết hạn không hợp lệ.'
  if (expiryDate && !issuedDate) errors[`certifications.${index}.issued_date`] = 'Phải nhập ngày cấp trước khi nhập ngày hết hạn.'
  if (issuedDate && expiryDate && expiryDate < issuedDate) errors[`certifications.${index}.expiry_date`] = 'Ngày hết hạn phải sau hoặc bằng ngày cấp.'
  if (!validHttpsUrl(item.document_url)) errors[`certifications.${index}.document_url`] = 'Tài liệu chứng chỉ phải là URL HTTPS hợp lệ.'
  requireValidBody(errors)

  return {
    certificate_name: certificateName,
    certificate_number: certificateNumber,
    issued_by: issuedBy,
    issued_date: issuedDate,
    expiry_date: expiryDate,
    document_url: item.document_url.trim(),
  }
}

export function validateTechnicianApplication(body) {
  assertObject(body, [
    'identity_number',
    'identity_front_url',
    'identity_back_url',
    'qualification_level',
    'years_experience',
    'bio',
    'areas',
    'skills',
    'certifications',
  ])

  const errors = {}
  const identityNumber = typeof body.identity_number === 'string' ? body.identity_number.trim() : ''
  const bio = typeof body.bio === 'string' ? body.bio.trim() : ''
  if (!/^0\d{11}$/.test(identityNumber)) errors.identity_number = 'CCCD phải gồm đúng 12 chữ số và bắt đầu bằng số 0.'
  if (!validHttpsUrl(body.identity_front_url)) errors.identity_front_url = 'Ảnh mặt trước CCCD phải là URL HTTPS hợp lệ.'
  if (!validHttpsUrl(body.identity_back_url)) errors.identity_back_url = 'Ảnh mặt sau CCCD phải là URL HTTPS hợp lệ.'
  if (
    typeof body.identity_front_url === 'string' &&
    typeof body.identity_back_url === 'string' &&
    body.identity_front_url.trim() === body.identity_back_url.trim()
  ) {
    errors.identity_back_url = 'Ảnh mặt trước và mặt sau CCCD không được trùng nhau.'
  }
  if (!qualificationLevels.includes(body.qualification_level)) errors.qualification_level = 'Trình độ chuyên môn không hợp lệ.'
  if (!Number.isInteger(body.years_experience) || body.years_experience < 0 || body.years_experience > 80) errors.years_experience = 'Số năm kinh nghiệm phải từ 0 đến 80.'
  if (bio.length < 20 || bio.length > 2000) errors.bio = 'Hồ sơ chuyên môn phải có từ 20 đến 2000 ký tự.'
  requireValidBody(errors)

  const { areas } = validateTechnicianAreas({ areas: body.areas })
  const { skills } = validateTechnicianSkills({ skills: body.skills })
  if (!skills.length) throw new AppError(422, 'SKILL_REQUIRED', 'Vui lòng chọn ít nhất một kỹ năng.')

  const certifications = body.certifications ?? []
  if (!Array.isArray(certifications) || certifications.length > 10) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Chỉ được gửi tối đa 10 chứng chỉ trong một hồ sơ.')
  }

  return {
    identity_number: identityNumber,
    identity_front_url: body.identity_front_url.trim(),
    identity_back_url: body.identity_back_url.trim(),
    qualification_level: body.qualification_level,
    years_experience: body.years_experience,
    bio,
    areas,
    skills,
    certifications: certifications.map(validateCertification),
  }
}
