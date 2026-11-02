export const MAX_VOUCHER_PERCENT = 20
export const MAX_VOUCHER_DISCOUNT = 50_000

export function voucherPolicyErrors(voucher) {
  const errors = {}
  const type = voucher.discount_type
  const value = Number(voucher.discount_value)
  const minimum = Number(voucher.minimum_order_amount)
  const cap = voucher.maximum_discount == null ? null : Number(voucher.maximum_discount)

  if (type === 'PERCENTAGE') {
    if (!Number.isInteger(value) || value < 1 || value > MAX_VOUCHER_PERCENT)
      errors.discount_value = 'Phần trăm giảm phải từ 1 đến 20%.'
  } else if (type === 'FIXED_AMOUNT') {
    if (!Number.isInteger(value) || value < 1 || value > MAX_VOUCHER_DISCOUNT)
      errors.discount_value = 'Số tiền giảm phải từ 1 đến 50.000 đồng.'
    if (Number.isInteger(value) && Number.isInteger(minimum) && minimum < value * 5)
      errors.minimum_order_amount = 'Giá trị dịch vụ tối thiểu phải ít nhất gấp 5 lần số tiền giảm.'
  } else errors.discount_type = 'Loại giảm giá không hợp lệ.'

  if (!Number.isInteger(minimum) || minimum < 0)
    errors.minimum_order_amount = 'Giá trị dịch vụ tối thiểu không hợp lệ.'
  if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > MAX_VOUCHER_DISCOUNT))
    errors.maximum_discount = 'Mức giảm tối đa phải từ 1 đến 50.000 đồng.'
  return errors
}

export function voucherDiscount(voucher, eligibleAmount) {
  const base = Number(eligibleAmount)
  if (!Number.isFinite(base) || base <= 0 || base < Number(voucher.minimum_order_amount)) return 0
  const raw = voucher.discount_type === 'PERCENTAGE'
    ? Math.round(base * Number(voucher.discount_value)) / 100
    : Number(voucher.discount_value)
  return Math.min(base, voucher.maximum_discount == null ? base : Number(voucher.maximum_discount), raw)
}

export function bookingVoucherLimit(eligibleAmount, commissionRate = null) {
  const rate = commissionRate == null ? MAX_VOUCHER_PERCENT / 100 : Number(commissionRate)
  return Math.min(
    MAX_VOUCHER_DISCOUNT,
    Math.round(Number(eligibleAmount) * Math.min(MAX_VOUCHER_PERCENT / 100, rate) * 100) / 100,
  )
}

export function voucherFitsBooking(voucher, eligibleAmount, commissionRate = null) {
  if (Object.keys(voucherPolicyErrors(voucher)).length) return false
  const discount = voucherDiscount(voucher, eligibleAmount)
  return discount > 0 && discount <= bookingVoucherLimit(eligibleAmount, commissionRate)
}
