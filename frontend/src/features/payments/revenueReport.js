export const reportMethods = {
  ALL: 'All Methods',
  CASH: 'Cash',
  VNPAY: 'VNPay',
  ZALOPAY: 'ZaloPay',
  FREE: 'Free',
}
const dayPattern = /^\d{4}-\d{2}-\d{2}$/

export function validReportDate(value) {
  if (typeof value !== 'string' || !dayPattern.test(value)) return false
  const year = Number(value.slice(0, 4))
  if (year < 1900 || year > 9999) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function dateString(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function monthEnd(year, month) {
  return dateString(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate())
}

export function deriveRevenueRange(period) {
  if (period.mode === 'custom') {
    if (!validReportDate(period.from) || !validReportDate(period.to)) {
      return { from: '', to: '', error: 'Choose valid From and To dates between 1900 and 9999.' }
    }
    if (period.from > period.to) {
      return { from: '', to: '', error: 'To date must be on or after From date.' }
    }
    return { from: period.from, to: period.to, error: '' }
  }
  const year = Number(period.year)
  if (!/^\d{4}$/.test(String(period.year)) || year < 1900 || year > 9999) {
    return { from: '', to: '', error: 'Choose a year between 1900 and 9999.' }
  }
  if (period.mode === 'year')
    return { from: dateString(year, 1, 1), to: dateString(year, 12, 31), error: '' }
  if (period.mode === 'month') {
    const month = Number(period.month)
    if (!/^\d{1,2}$/.test(String(period.month)) || month < 1 || month > 12) {
      return { from: '', to: '', error: 'Choose a valid month.' }
    }
    return { from: dateString(year, month, 1), to: monthEnd(year, month), error: '' }
  }
  if (period.mode === 'quarter' && /^[1-4]$/.test(String(period.quarter))) {
    const startMonth = (Number(period.quarter) - 1) * 3 + 1
    return { from: dateString(year, startMonth, 1), to: monthEnd(year, startMonth + 2), error: '' }
  }
  return { from: '', to: '', error: 'Choose a valid report period.' }
}

export function defaultRevenuePeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type) => parts.find((part) => part.type === type).value
  const year = get('year')
  const month = get('month')
  return {
    mode: 'month',
    year,
    month,
    quarter: String(Math.ceil(Number(month) / 3)),
    from: `${year}-${month}-01`,
    to: monthEnd(Number(year), Number(month)),
  }
}

export function revenueFilename(disposition, from, to) {
  const start = validReportDate(from) ? from.replaceAll('-', '') : 'start'
  const end = validReportDate(to) ? to.replaceAll('-', '') : 'end'
  const fallback = `CoolCare_Revenue_${start}_${end}.xlsx`
  const match =
    typeof disposition === 'string' &&
    disposition.match(/\bfilename\s*=\s*(?:"([^"]*)"|([^;\s]+))/i)
  const name = match && (match[1] ?? match[2])
  return name &&
    name.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._ -]*\.xlsx$/i.test(name) &&
    !name.includes('..')
    ? name
    : fallback
}

export function revenueRowCount(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const count = Number(value)
  return Number.isInteger(count) && count >= 0 && count <= 10_000 ? count : null
}

export function downloadRevenueBlob(blob, filename) {
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = filename
  link.hidden = true
  try {
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    // Let the browser start reading the object URL before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
