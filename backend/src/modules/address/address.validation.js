import { AppError } from '../../utils.js'

function requiredString(value, fieldName, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', `${fieldName} is required.`)
  }

  const valueTrimmed = value.trim()

  if (valueTrimmed.length > maxLength) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${fieldName} must not exceed ${maxLength} characters.`
    )
  }

  return valueTrimmed
}

function optionalCoordinate(value, fieldName, min, max) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const number = Number(value)

  if (!Number.isFinite(number) || number < min || number > max) {
    throw new AppError(400, 'VALIDATION_ERROR', `${fieldName} is invalid.`)
  }

  return number
}

export function validateAddressInput(body = {}) {
  const recipientName = requiredString(body.recipient_name, 'Recipient name', 100)

  const phone = requiredString(body.phone, 'Phone number', 10)

  if (!/^0[0-9]{9}$/.test(phone)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Phone number must contain exactly 10 digits and start with 0.'
    )
  }

  return {
    recipientName,

    phone,

    city: requiredString(body.city, 'City/Province', 100),

    ward: requiredString(body.ward, 'Ward/Commune', 100),

    addressLine: requiredString(body.address_line, 'Street address', 255),

    latitude: optionalCoordinate(body.latitude, 'Latitude', -90, 90),

    longitude: optionalCoordinate(body.longitude, 'Longitude', -180, 180),

    isDefault: body.is_default === true,
  }
}
