export const withdrawalStatuses = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  SUCCESS: 'Success',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}

export const validWithdrawalId = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

const integers = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const date = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Etc/GMT-7',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const time = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Etc/GMT-7',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function formatWithdrawalAmount(value) {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value)))
    return '—'
  const text = String(value)
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  const decimals = fraction.padEnd(2, '0')
  return `${text.startsWith('-') ? '-' : ''}${integers.format(BigInt(whole))}${Number(decimals) ? `.${decimals}` : ''} ₫`
}

function displayTimestamp(value, formatter) {
  if (!value) return '—'
  const instant = new Date(value)
  return Number.isFinite(instant.getTime()) ? formatter.format(instant) : '—'
}

export const formatWithdrawalDate = (value) => displayTimestamp(value, date)
export const formatWithdrawalTime = (value) => displayTimestamp(value, time)
export const withdrawalText = (value) =>
  value === null || value === undefined || value === '' ? '—' : value
export const withdrawalReference = (withdrawal) =>
  withdrawal.payoutReference || `${withdrawal.id.slice(0, 8)}…${withdrawal.id.slice(-4)}`
