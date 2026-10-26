const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const vietnamDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

export function formatSettlementAmount(value, locale = 'en', signed = false, showCurrency = true) {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value)))
    return '—'
  const text = String(value)
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  const negative = text.startsWith('-') && minor !== 0n
  const number = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    maximumFractionDigits: 0,
  })
  const decimals = fraction.replace(/0+$/, '')
  const separator = locale === 'vi' ? ',' : '.'
  return `${negative ? '−' : signed && minor > 0n ? '+' : ''}${number.format(BigInt(whole))}${decimals ? separator + decimals.padEnd(2, '0') : ''}${showCurrency ? ' ₫' : ''}`
}

export function settlementAmountTone(value) {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value)))
    return ''
  const text = String(value)
  if (BigInt(text.replace(/[.-]/g, '')) === 0n) return ''
  return text.startsWith('-') ? 'negative' : 'positive'
}

export function formatSettlementDate(value) {
  if (!value) return '—'
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+07:00` : value)
  return Number.isFinite(date.getTime()) ? vietnamDay.format(date) : '—'
}

export function formatSettlementTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function formatSettlementPeriod(period) {
  if (!period?.start || !period?.end) return '—'
  const end = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(period.end) ? `${period.end}T00:00:00+07:00` : period.end
  )
  if (!Number.isFinite(end.getTime())) return '—'
  return `${formatSettlementDate(period.start)} – ${formatSettlementDate(new Date(end.getTime() - 86_400_000).toISOString())}`
}

export function technicianInitials(name) {
  return (
    (name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  )
}

export function settlementErrorMessage(error, detail = false) {
  if (error.status === 401) return 'Your session has expired. Please sign in again.'
  if (error.status === 403) return 'You do not have permission to view settlements.'
  if (error.status === 404) return 'This settlement could not be found.'
  if (error.status === 400 || error.status === 422)
    return detail
      ? 'The settlement request is invalid.'
      : 'Check the settlement filters and try again.'
  if (!error.status) return 'Unable to connect to the server. Please try again.'
  return detail
    ? 'Unable to load settlement details. Please try again.'
    : 'Unable to load settlements. Please try again.'
}

export const settlementTransactionTypes = {
  CASH_SETTLEMENT: 'Cash settlement',
  ONLINE_EARNING: 'Online earnings',
  TOPUP: 'Top-up',
  TOP_UP: 'Top-up',
  WITHDRAWAL: 'Withdrawal',
  ADJUSTMENT: 'Adjustment',
}

export function settlementSourceUrl(source) {
  if (!source || !uuid.test(source.id ?? '')) return null
  const routes = {
    PAYMENT: 'payments',
    TOPUP: 'topups',
    TOP_UP: 'topups',
    WITHDRAWAL: 'withdrawals',
  }
  const route = routes[source.type]
  return route ? `/admin/${route}/${source.id}` : null
}
