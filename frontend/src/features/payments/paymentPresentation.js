export const paymentStatuses = {
  SUCCESS: 'Paid',
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}

export const paymentMethods = { CASH: 'Cash', VNPAY: 'VNPay', ZALOPAY: 'ZaloPay', FREE: 'Free' }

const wholeAmount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const decimalAmount = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const timestamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function formatPaymentAmount(value) {
  if (value === null || value === undefined || value === '') return 'Not available'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 'Not available'
  return `${(Number.isInteger(amount) ? wholeAmount : decimalAmount).format(amount)} ₫`
}

export function formatPaymentTime(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? timestamp.format(date) : 'Not available'
}

export function humanizeStatus(value) {
  return value
    ? value
        .toLowerCase()
        .split('_')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(' ')
    : 'Not available'
}

export function personInitials(name) {
  return (
    (name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '—'
  )
}

export function safePdfUrl(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

function minorUnits(value) {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value)))
    return null
  const negative = String(value).startsWith('-')
  const [whole, fraction = ''] = String(value).replace(/^-/, '').split('.')
  const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return negative ? -units : units
}

export function paymentLedgerEvidence(payment) {
  if (payment.status !== 'SUCCESS') {
    return {
      label: 'Not recorded',
      explanation: 'No successful payment posting confirmed.',
      recorded: false,
    }
  }
  const cash = payment.kind === 'CASH'
  const commission = minorUnits(payment.commissionAmount)
  const discount = minorUnits(payment.platformDiscountAmount)
  const expected = cash
    ? commission !== null && discount !== null
      ? discount - commission
      : null
    : ['ONLINE', 'FREE'].includes(payment.kind)
      ? minorUnits(payment.technicianEarning)
      : null
  const type = cash ? 'CASH_SETTLEMENT' : 'ONLINE_EARNING'
  const record = (payment.ledger ?? []).find(
    (row) =>
      row.transactionType === type && expected !== null && minorUnits(row.amount) === expected
  )
  if (!record) {
    return {
      label: 'Not available',
      explanation: 'Matching wallet posting evidence is not available.',
      recorded: false,
    }
  }
  return {
    label: expected === 0n ? 'No wallet change' : expected > 0n ? 'Credited' : 'Wallet debit',
    explanation: cash ? 'Cash settlement recorded.' : 'Payment earning recorded.',
    recorded: true,
    direction: expected === 0n ? 'zero' : expected > 0n ? 'credit' : 'debit',
    record,
  }
}
