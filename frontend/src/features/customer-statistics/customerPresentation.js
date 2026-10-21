import {
  presetReportRange,
  readReportRange,
  reportRangeError,
  reportRangeQuery,
} from '../reports/reportPresentation.js'

export const customerTabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'new', label: 'New Customers' },
  { key: 'areas', label: 'Customers by Area' },
  { key: 'services', label: 'Customer Service Usage' },
  { key: 'cancellations', label: 'Cancellation / Rejection' },
  { key: 'locked', label: 'Locked Customers' },
]
export const customerPageSizes = [10, 20, 50]
const allowedQuery = new Set(['tab', 'from', 'to', 'search', 'page', 'limit'])

export function readCustomerFilters(params, defaults = presetReportRange()) {
  const tab = params.get('tab') ?? 'overview'
  const range = readReportRange(params, defaults)
  const search = (params.get('search') ?? '').trim()
  const pageText = params.get('page') ?? '1'
  const limitText = params.get('limit') ?? '10'
  let error = ''
  if ([...params.keys()].some((key) => !allowedQuery.has(key) || params.getAll(key).length > 1))
    error = 'The customer statistics link contains unsupported or repeated filters.'
  else if (!customerTabs.some((item) => item.key === tab))
    error = 'Choose a valid customer statistics tab.'
  else if (reportRangeError(range)) error = reportRangeError(range)
  else if (
    search.length > 150 ||
    [...(params.get('search') ?? '')].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    )
  )
    error = 'Use a search term of 150 characters or fewer, without control characters.'
  else if (!/^[1-9]\d*$/.test(pageText) || Number(pageText) > 1_000_000)
    error = 'Choose a valid page between 1 and 1,000,000.'
  else if (!customerPageSizes.map(String).includes(limitText))
    error = 'Choose 10, 20, or 50 rows per page.'
  return { tab, range, search, page: Number(pageText), limit: Number(limitText), error }
}

export function customerFiltersQuery(filters) {
  const params = new URLSearchParams(reportRangeQuery(filters.range))
  params.set('tab', filters.tab)
  if (filters.search) params.set('search', filters.search)
  if (filters.page !== 1) params.set('page', String(filters.page))
  if (filters.limit !== 10) params.set('limit', String(filters.limit))
  return params.toString()
}

export function customerApiQuery(filters) {
  const params = new URLSearchParams(reportRangeQuery(filters.range))
  if (filters.tab === 'locked') {
    if (filters.search) params.set('search', filters.search)
    params.set('page', String(filters.page))
    params.set('limit', String(filters.limit))
  }
  return params.toString()
}

export function customerErrorKey(error) {
  if (error?.status === 403) return 'You do not have permission to view customer statistics.'
  if (error?.status === 422) return 'Check the customer statistics filters and try again.'
  if (error?.message === 'Không thể kết nối máy chủ. Vui lòng thử lại.')
    return 'Unable to connect to the server. Please try again.'
  return 'Unable to load customer statistics. Please try again.'
}

export function customerDecimal(value, locale = 'en') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    maximumFractionDigits: 2,
  }).format(Number(value))
}

export function customerShare(count, total) {
  return total > 0 ? (count * 100) / total : 0
}

export function customerAreaRows(areas) {
  if (areas.items.length <= 8) return areas.items
  const remainder = areas.items.slice(8).reduce((sum, row) => sum + row.count, 0)
  return [
    ...areas.items.slice(0, 8),
    {
      key: 'OTHER_AREAS',
      label: 'Other areas',
      count: remainder,
      percentage: customerShare(remainder, areas.totalCustomers),
      other: true,
    },
  ]
}

export function customerChartScale(rows, keys) {
  const largest = rows.reduce(
    (maximum, row) => Math.max(maximum, ...keys.map((key) => Number(row[key] ?? 0))),
    0
  )
  const rawStep = largest / 4
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)))
  const multiple = [1, 2, 2.5, 5, 10].find((value) => value * magnitude >= rawStep) ?? 10
  const step = Math.max(1, Math.ceil(multiple * magnitude))
  return step * 4
}

export function customerInitials(name) {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}
