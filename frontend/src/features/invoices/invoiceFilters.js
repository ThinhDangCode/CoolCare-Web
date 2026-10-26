import {
  defaultRevenuePeriod,
  deriveRevenueRange,
  validReportDate,
} from '../payments/revenueReport.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const invoiceStatuses = { PAID: 'Invoice paid', UNRECORDED: 'No payment recorded' }

export function initialInvoiceFilters(now = new Date()) {
  const { from, to } = defaultRevenuePeriod(now)
  return { search: '', status: 'ALL', service: 'ALL', from, to, page: 1, limit: 10 }
}

export function invoiceMonthRange(year, month) {
  const result = deriveRevenueRange({ mode: 'month', year, month })
  return result.error ? null : { from: result.from, to: result.to }
}

export function readInvoiceFilters(params, now = new Date()) {
  const initial = initialInvoiceFilters(now)
  const page = Number(params.get('page'))
  const limit = Number(params.get('limit'))
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const validRange = validReportDate(from) && validReportDate(to) && from <= to
  const range =
    params.get('period') === 'all' ? { from: '', to: '' } : validRange ? { from, to } : initial
  return {
    search: (params.get('search') ?? '')
      .replace(/\p{Cc}/gu, '')
      .trim()
      .slice(0, 150),
    status: Object.hasOwn(invoiceStatuses, params.get('status')) ? params.get('status') : 'ALL',
    service: uuid.test(params.get('service') ?? '') ? params.get('service').toLowerCase() : 'ALL',
    from: range.from,
    to: range.to,
    page: Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1,
    limit: [10, 25, 50].includes(limit) ? limit : 10,
  }
}

export function writeInvoiceFilters(filters) {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.status !== 'ALL') params.set('status', filters.status)
  if (filters.service !== 'ALL') params.set('service', filters.service)
  if (!filters.from && !filters.to) params.set('period', 'all')
  else {
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
  }
  if (filters.page !== 1) params.set('page', filters.page)
  if (filters.limit !== 10) params.set('limit', filters.limit)
  return params
}

export function invoiceApiQuery(filters) {
  const params = writeInvoiceFilters(filters)
  params.delete('period')
  params.set('page', filters.page)
  params.set('limit', filters.limit)
  return params.toString()
}

export function invoicePeriodLabel(filters) {
  if (!filters.from && !filters.to) return 'All time'
  const year = filters.from.slice(0, 4)
  const month = filters.from.slice(5, 7)
  const fullMonth = invoiceMonthRange(year, month)
  if (fullMonth && fullMonth.from === filters.from && fullMonth.to === filters.to) {
    return `${month}/${year}`
  }
  const display = (value) => value.split('-').reverse().join('/')
  return `${display(filters.from)} – ${display(filters.to)}`
}
