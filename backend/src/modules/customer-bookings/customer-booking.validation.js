import { AppError } from '../../utils.js'

const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const PHONE_PATTERN = /^0[0-9]{9}$/

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function nonBlank(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
}

function optionalDescription(value, maxLength = 2000) {
  return value == null || (
    typeof value === 'string' &&
    value.trim().length <= maxLength
  )
}

function fail(errors) {
  if (Object.keys(errors).length > 0) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'Invalid booking data.',
      errors
    )
  }
}

/**
 * Validate the customer booking request before any database writes.
 * Prices, customer identity, address snapshots and booking codes must be
 * resolved on the server, never trusted from client input.
 */
export function validateCreateBookingBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'Booking data must be an object.'
    )
  }

  const errors = {}

  if (!isUuid(body.customerAddressId)) {
    errors.customerAddressId = 'A valid address is required.'
  }

  if (!nonBlank(body.recipientName, 100)) {
    errors.recipientName =
      'Recipient name is required (max 100 characters).'
  }

  if (
    typeof body.recipientPhone !== 'string' ||
    !PHONE_PATTERN.test(body.recipientPhone)
  ) {
    errors.recipientPhone =
      'Recipient phone must contain 10 digits and start with 0.'
  }

  if (!optionalDescription(body.description)) {
    errors.description =
      'Description must be at most 2000 characters.'
  }

  const scheduledAt =
    typeof body.scheduledAt === 'string'
      ? new Date(body.scheduledAt)
      : new Date(NaN)

  if (
    !Number.isFinite(scheduledAt.getTime()) ||
    scheduledAt.getTime() <= Date.now()
  ) {
    errors.scheduledAt =
      'Schedule must be a valid future date and time.'
  }

  if (
    !Array.isArray(body.units) ||
    body.units.length === 0 ||
    body.units.length > 20
  ) {
    errors.units = 'Provide between 1 and 20 AC units.'
  } else {
    body.units.forEach((unit, index) => {
      const key = `units[${index}]`

      if (
        !unit ||
        typeof unit !== 'object' ||
        Array.isArray(unit)
      ) {
        errors[key] = 'AC unit must be an object.'
        return
      }

      if (
        unit.acBrandId != null &&
        !isUuid(unit.acBrandId)
      ) {
        errors[`${key}.acBrandId`] = 'Invalid AC brand ID.'
      }

      if (
        unit.acModelId != null &&
        !isUuid(unit.acModelId)
      ) {
        errors[`${key}.acModelId`] = 'Invalid AC model ID.'
      }

      if (unit.acModelId && !unit.acBrandId) {
        errors[`${key}.acBrandId`] =
          'AC brand is required when a model is selected.'
      }

      if (!optionalDescription(unit.description)) {
        errors[`${key}.description`] =
          'Description must be at most 2000 characters.'
      }

      if (
        !Array.isArray(unit.serviceIds) ||
        unit.serviceIds.length === 0
      ) {
        errors[`${key}.serviceIds`] =
          'Select at least one service.'
      } else if (
        unit.serviceIds.some((id) => !isUuid(id)) ||
        new Set(unit.serviceIds).size !== unit.serviceIds.length
      ) {
        errors[`${key}.serviceIds`] =
          'Service IDs must be valid and unique within each AC unit.'
      }
    })
  }

  fail(errors)

  return {
    customerAddressId: body.customerAddressId,
    recipientName: body.recipientName.trim(),
    recipientPhone: body.recipientPhone,
    description: body.description?.trim() || null,
    scheduledAt: scheduledAt.toISOString(),
    units: body.units.map((unit) => ({
      acBrandId: unit.acBrandId ?? null,
      acModelId: unit.acModelId ?? null,
      description: unit.description?.trim() || null,
      serviceIds: [...unit.serviceIds],
    })),
  }
}