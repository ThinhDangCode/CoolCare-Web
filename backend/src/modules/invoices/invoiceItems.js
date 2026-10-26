const serviceIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

function scaledDecimal(value, scale) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > scale) return null
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'))
}

function decimalString(value, scale) {
  const digits = value.toString().padStart(scale + 1, '0')
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}

function ratio(numerator, denominator) {
  let a = numerator
  let b = denominator
  while (b) [a, b] = [b, a % b]
  return `${numerator / a}/${denominator / a}`
}

function groupingValues(item) {
  if (
    !['SERVICE', 'LABOR'].includes(item.itemType) ||
    typeof item.service?.id !== 'string' ||
    !serviceIdPattern.test(item.service.id) ||
    typeof item.description !== 'string' ||
    !item.description.trim() ||
    typeof item.unit !== 'string' ||
    !item.unit.trim()
  )
    return null

  const quantity = scaledDecimal(item.quantity, 3)
  const unitPrice = scaledDecimal(item.unitPrice, 2)
  const discount = scaledDecimal(item.discountAmount, 2)
  const total = scaledDecimal(item.totalPrice, 2)
  if (quantity === null || quantity === 0n || [unitPrice, discount, total].includes(null))
    return null

  return {
    key: JSON.stringify([
      item.itemType,
      item.service.id.toLowerCase(),
      item.description,
      item.unit,
      unitPrice.toString(),
      ratio(discount, quantity),
      // Preserve differing effective prices, including stored rounding differences.
      ratio(total, quantity),
    ]),
    quantity,
    discount,
    total,
  }
}

// Group presentation rows only; retain the first row's snapshot and stable position.
export function groupInvoiceItems(items = []) {
  const rows = []
  const groups = new Map()
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      rows.push(item)
      continue
    }
    const values = groupingValues(item)
    const existing = values && groups.get(values.key)
    if (existing) {
      existing.quantity += values.quantity
      existing.discount += values.discount
      existing.total += values.total
      existing.row.quantity = decimalString(existing.quantity, 3)
      existing.row.discountAmount = decimalString(existing.discount, 2)
      existing.row.totalPrice = decimalString(existing.total, 2)
    } else {
      const row = { ...item }
      rows.push(row)
      if (values) groups.set(values.key, { ...values, row })
    }
  }
  return rows
}
