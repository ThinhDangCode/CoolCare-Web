export function revenueUnits(value) {
  const text = String(value)
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Invalid exact revenue amount')
  const negative = text.startsWith('-')
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return negative ? -units : units
}
export function revenueDecimal(units) {
  const negative = units < 0n
  const absolute = negative ? -units : units
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}
export function roundedDivide(numerator, denominator) {
  if (denominator <= 0n) throw new Error('Invalid revenue denominator')
  const sign = numerator < 0n ? -1n : 1n
  const absolute = numerator < 0n ? -numerator : numerator
  const quotient = absolute / denominator
  return sign * (quotient + ((absolute % denominator) * 2n >= denominator ? 1n : 0n))
}
export function revenuePercent(numerator, denominator) {
  if (denominator <= 0n) return null
  return Number(roundedDivide(numerator * 10_000n, denominator)) / 100
}
