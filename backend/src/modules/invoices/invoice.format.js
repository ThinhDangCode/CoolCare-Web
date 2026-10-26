const TIME_ZONE = 'Asia/Ho_Chi_Minh'

export function formatVnd(value) {
  const amount = Math.round(Number(value) || 0)
  const digits = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${amount < 0 ? '-' : ''}${digits} ₫`
}

function parts(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(formatted.map(({ type, value: text }) => [type, text]))
}

export function formatDate(value) {
  const p = value ? parts(value) : null
  return p ? `${p.day}/${p.month}/${p.year}` : '—'
}

export function formatDateTime(value) {
  const p = value ? parts(value) : null
  return p ? `${p.day}/${p.month}/${p.year} · ${p.hour}:${p.minute}` : '—'
}

// 0909000123 -> 09•• ••• 123 (matches the invoice design).
export function maskPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length < 6) return digits ? '•'.repeat(digits.length) : '—'
  const middle = '•'.repeat(digits.length - 5)
  const grouped = middle.length > 2 ? `${middle.slice(0, 2)} ${middle.slice(2)}` : middle
  return `${digits.slice(0, 2)}${grouped} ${digits.slice(-3)}`
}

export function maskEmail(value) {
  const [name = '', domain = ''] = String(value ?? '').split('@')
  if (!domain) return '—'
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(name.length - 2, 2))}@${domain}`
}

export function formatQuantity(value) {
  const quantity = Number(value)
  if (!Number.isFinite(quantity)) return '1'
  return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(2)))
}

const STATUS_LABELS = Object.freeze({
  SUCCESS: 'Đã thanh toán',
  PENDING: 'Chờ thanh toán',
  PROCESSING: 'Đang xử lý',
  FAILED: 'Thất bại',
  CANCELLED: 'Đã hủy',
})

const METHOD_LABELS = Object.freeze({
  CASH: 'Tiền mặt',
  VNPAY: 'VNPay',
  ZALOPAY: 'ZaloPay',
  FREE: 'Miễn phí',
})

export const paymentStatusLabel = (status) => STATUS_LABELS[String(status).toUpperCase()] ?? 'Không xác định'
export const paymentMethodLabel = (code) => METHOD_LABELS[String(code ?? '').toUpperCase()] ?? (code ? String(code) : '—')

export function invoiceFilename(invoiceNumber) {
  const safe = String(invoiceNumber ?? 'invoice').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return `HoaDon-${safe || 'invoice'}.pdf`
}
