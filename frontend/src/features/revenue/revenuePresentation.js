const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const percentFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const shortFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatRevenueAmount(value) {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value)))
    return '—'
  const text = String(value)
  const negative = text.startsWith('-')
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  const decimals = fraction.padEnd(2, '0')
  return `${negative ? '-' : ''}${integerFormat.format(BigInt(whole))}${Number(decimals) ? `.${decimals}` : ''} ₫`
}

export function formatRevenuePercent(value, signed = false) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)))
    return '—'
  const number = Number(value)
  return `${signed && number > 0 ? '+' : ''}${percentFormat.format(number)}%`
}

export function revenueNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function compactRevenueAmount(value) {
  return `${shortFormat.format(value)} ₫`
}

export function revenueLinePath(rows, field, point) {
  let connected = false
  return rows
    .map((row, index) => {
      const value = revenueNumber(row[field])
      if (value === null) {
        connected = false
        return ''
      }
      const command = connected ? 'L' : 'M'
      connected = true
      const { x, y } = point(value, index)
      return `${command}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .filter(Boolean)
    .join(' ')
}

export function revenueAreaPath(rows, field, point, baseline) {
  const parts = []
  let segment = []
  const closeSegment = () => {
    if (!segment.length) return
    const first = segment[0]
    const last = segment[segment.length - 1]
    const line = segment
      .map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' ')
    parts.push(
      `${line} L${last.x.toFixed(2)},${baseline.toFixed(2)} L${first.x.toFixed(2)},${baseline.toFixed(2)} Z`
    )
    segment = []
  }
  rows.forEach((row, index) => {
    const value = revenueNumber(row[field])
    if (value === null) closeSegment()
    else segment.push(point(value, index))
  })
  closeSegment()
  return parts.join(' ')
}

export const displayRevenueDate = (value) => value?.split('-').reverse().join('/') ?? '—'

export function revenuePeriodLabel(period) {
  if (period.type === 'YEAR') return String(period.year)
  if (period.type === 'QUARTER') return `Q${period.quarter} / ${period.year}`
  return `${String(period.month).padStart(2, '0')}/${period.year}`
}
