export const blankVoucher = {
  code: '',
  name: '',
  discount_type: 'PERCENTAGE',
  discount_value: '',
  minimum_order_amount: '',
  maximum_discount: '',
  usage_limit: '',
  usage_limit_per_customer: '1',
  start_at: '',
  end_at: '',
  is_active: true,
}
const localDateTime = (value) => (value ? new Date(value).toISOString().slice(0, 16) : '')
export function voucherToForm(row) {
  return {
    ...blankVoucher,
    ...row,
    discount_value: Number(row.discount_value),
    minimum_order_amount: Number(row.minimum_order_amount),
    maximum_discount: row.maximum_discount ?? '',
    usage_limit: row.usage_limit ?? '',
    usage_limit_per_customer: row.usage_limit_per_customer ?? '',
    start_at: localDateTime(row.start_at),
    end_at: localDateTime(row.end_at),
  }
}
export function voucherPayload(form) {
  return {
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    discount_type: form.discount_type,
    discount_value: Number(form.discount_value),
    minimum_order_amount: Number(form.minimum_order_amount),
    maximum_discount: form.maximum_discount === '' ? null : Number(form.maximum_discount),
    usage_limit: form.usage_limit === '' ? null : Number(form.usage_limit),
    usage_limit_per_customer:
      form.usage_limit_per_customer === '' ? null : Number(form.usage_limit_per_customer),
    start_at: new Date(form.start_at).toISOString(),
    end_at: new Date(form.end_at).toISOString(),
  }
}

export function validateVoucherForm(form) {
  const errors = {}
  const code = form.code.trim()
  const discount = Number(form.discount_value)
  const minimum = Number(form.minimum_order_amount)
  const maximum = form.maximum_discount === '' ? null : Number(form.maximum_discount)
  const totalLimit = form.usage_limit === '' ? null : Number(form.usage_limit)
  const customerLimit =
    form.usage_limit_per_customer === '' ? null : Number(form.usage_limit_per_customer)
  const start = new Date(form.start_at)
  const end = new Date(form.end_at)

  if (!/^[A-Za-z0-9_-]{3,20}$/.test(code))
    errors.code = 'Use 3–20 letters, numbers, hyphens, or underscores.'
  if (!form.name.trim()) errors.name = 'Description is required.'
  else if (form.name.trim().length > 100)
    errors.name = 'Description must not exceed 100 characters.'
  if (!Number.isInteger(discount) || discount <= 0)
    errors.discount_value = 'Enter a positive whole number.'
  else if (form.discount_type === 'PERCENTAGE' && discount > 100)
    errors.discount_value = 'Enter a whole percentage from 1 to 100.'
  if (!Number.isInteger(minimum) || minimum < 0)
    errors.minimum_order_amount = 'Minimum order amount must be a non-negative whole number.'
  if (maximum !== null && (!Number.isInteger(maximum) || maximum < 0))
    errors.maximum_discount = 'Maximum discount must be a non-negative whole number.'
  if (!['PERCENTAGE', 'FIXED_AMOUNT'].includes(form.discount_type))
    errors.discount_type = 'Select a valid discount type.'
  if (totalLimit !== null && (!Number.isInteger(totalLimit) || totalLimit < 1))
    errors.usage_limit = 'Usage limit must be a positive whole number.'
  if (customerLimit !== null && (!Number.isInteger(customerLimit) || customerLimit < 1))
    errors.usage_limit_per_customer = 'Customer limit must be a positive whole number.'
  if (totalLimit !== null && customerLimit !== null && customerLimit > totalLimit)
    errors.usage_limit_per_customer = 'Customer limit cannot exceed the total usage limit.'
  if (!form.start_at || Number.isNaN(start.getTime()))
    errors.start_at = 'Start date and time are required.'
  if (!form.end_at || Number.isNaN(end.getTime())) errors.end_at = 'End date and time are required.'
  else if (!Number.isNaN(start.getTime()) && end <= start)
    errors.end_at = 'End date and time must be after the start.'
  return errors
}
