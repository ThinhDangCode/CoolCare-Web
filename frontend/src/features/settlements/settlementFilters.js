import {
  defaultRevenuePeriod,
  deriveRevenueRange,
  validReportDate,
} from '../payments/revenueReport.js'

export const settlementStatuses = {
  OPEN: 'Unfinalized',
  CALCULATED: 'Awaiting clearance',
  SETTLED: 'Cleared',
  OVERDUE: 'Overdue',
}

export function initialSettlementFilters(now = new Date()) {
  const { from, to } = defaultRevenuePeriod(now)
  return { search: '', status: 'ALL', from, to, page: 1, limit: 10 }
}

export function settlementMonthRange(year, month) {
  const result = deriveRevenueRange({ mode: 'month', year, month })
  return result.error ? null : { from: result.from, to: result.to }
}

export function settlementRangeError({ from, to }) {
  if ((from && !validReportDate(from)) || (to && !validReportDate(to)))
    return 'Enter valid dates in YYYY-MM-DD format.'
  if (from && to && from > to) return 'To date must be on or after From date.'
  return ''
}

export function readSettlementFilters(params, now = new Date()) {
  const initial = initialSettlementFilters(now)
  const rawRange = { from: params.get('from') ?? '', to: params.get('to') ?? '' }
  const hasRange = Boolean(rawRange.from || rawRange.to)
  const range =
    params.get('period') === 'all'
      ? { from: '', to: '' }
      : hasRange && !settlementRangeError(rawRange)
        ? rawRange
        : initial
  const page = Number(params.get('page'))
  const limit = Number(params.get('limit'))
  return {
    search: (params.get('search') ?? '')
      .replace(/\p{Cc}/gu, '')
      .trim()
      .slice(0, 150),
    status: Object.hasOwn(settlementStatuses, params.get('status')) ? params.get('status') : 'ALL',
    from: range.from,
    to: range.to,
    page: Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1,
    limit: [10, 25, 50].includes(limit) ? limit : 10,
  }
}

export function writeSettlementFilters(filters) {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.status !== 'ALL') params.set('status', filters.status)
  if (!filters.from && !filters.to) params.set('period', 'all')
  else {
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
  }
  if (filters.page !== 1) params.set('page', filters.page)
  if (filters.limit !== 10) params.set('limit', filters.limit)
  return params
}

export function settlementApiQuery(filters) {
  const params = writeSettlementFilters(filters)
  params.delete('period')
  params.set('page', filters.page)
  params.set('limit', filters.limit)
  return params.toString()
}

export function settlementPeriodLabel({ from, to }, t = (key) => key) {
  if (!from && !to) return t('All time')
  if (from && to) {
    const month = settlementMonthRange(from.slice(0, 4), from.slice(5, 7))
    if (month?.from === from && month.to === to) return `${from.slice(5, 7)}/${from.slice(0, 4)}`
  }
  const display = (day) => (day ? day.split('-').reverse().join('/') : t('Any date'))
  return `${display(from)} – ${display(to)}`
}
