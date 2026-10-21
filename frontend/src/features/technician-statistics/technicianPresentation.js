import {
  presetReportRange,
  readReportRange,
  reportMoneyUnits,
  reportRangeError,
  reportRangeQuery,
} from '../reports/reportPresentation.js'

export const technicianTabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'income', label: 'Technician Earnings' },
  { key: 'areas', label: 'Area Distribution' },
  { key: 'services', label: 'Service Performance' },
  { key: 'issues', label: 'Technician Issues' },
  { key: 'locked', label: 'Locked Technicians' },
]
export const technicianPageSizes = [10, 20, 50]
const allowedQuery = new Set(['tab', 'from', 'to', 'search', 'page', 'limit'])

export function readTechnicianFilters(params, defaults = presetReportRange()) {
  const tab = params.get('tab') ?? 'overview'
  const range = readReportRange(params, defaults)
  const rawSearch = params.get('search') ?? ''
  const search = rawSearch.trim()
  const pageText = params.get('page') ?? '1'
  const limitText = params.get('limit') ?? '10'
  let error = ''
  if ([...params.keys()].some((key) => !allowedQuery.has(key) || params.getAll(key).length > 1))
    error = 'The technician statistics link contains unsupported or repeated filters.'
  else if (!technicianTabs.some((item) => item.key === tab))
    error = 'Choose a valid technician statistics tab.'
  else if (reportRangeError(range)) error = reportRangeError(range)
  else if (
    rawSearch.length > 150 ||
    [...rawSearch].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    )
  )
    error = 'Use a search term of 150 characters or fewer, without control characters.'
  else if (!/^[1-9]\d*$/.test(pageText) || Number(pageText) > 1_000_000)
    error = 'Choose a valid page between 1 and 1,000,000.'
  else if (!technicianPageSizes.map(String).includes(limitText))
    error = 'Choose 10, 20, or 50 rows per page.'
  return { tab, range, search, page: Number(pageText), limit: Number(limitText), error }
}

export function technicianFiltersQuery(filters) {
  const params = new URLSearchParams(reportRangeQuery(filters.range))
  params.set('tab', filters.tab)
  if (filters.search) params.set('search', filters.search)
  if (filters.page !== 1) params.set('page', String(filters.page))
  if (filters.limit !== 10) params.set('limit', String(filters.limit))
  return params.toString()
}

export function technicianApiQuery(filters) {
  const params = new URLSearchParams(reportRangeQuery(filters.range))
  if (filters.tab === 'locked') {
    if (filters.search) params.set('search', filters.search)
    params.set('page', String(filters.page))
    params.set('limit', String(filters.limit))
  }
  return params.toString()
}

export function technicianErrorKey(error) {
  if (error?.status === 403) return 'You do not have permission to view technician statistics.'
  if (error?.status === 422) return 'Check the technician statistics filters and try again.'
  if (error?.message === 'Không thể kết nối máy chủ. Vui lòng thử lại.')
    return 'Unable to connect to the server. Please try again.'
  return 'Unable to load technician statistics. Please try again.'
}

export function technicianDecimal(value, locale = 'en') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    maximumFractionDigits: 2,
  }).format(Number(value))
}

export function technicianRate(completed, total) {
  return total > 0 ? (completed * 100) / total : null
}

export function technicianScale(rows, keys) {
  const max = rows.reduce(
    (value, row) => Math.max(value, ...keys.map((key) => Number(row[key] ?? 0))),
    0
  )
  const rawStep = max / 4
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)))
  const multiple = [1, 2, 2.5, 5, 10].find((value) => value * magnitude >= rawStep) ?? 10
  return Math.max(1, Math.ceil(multiple * magnitude)) * 4
}

export function technicianMoneyScale(rows) {
  const values = rows.flatMap((row) => [
    reportMoneyUnits(row.amount),
    reportMoneyUnits(row.knownAmount),
  ])
  const largest = values.reduce((max, value) => (value !== null && value > max ? value : max), 0n)
  const magnitude = largest > 0n ? 10n ** BigInt(String(largest).length - 1) : 1n
  const step = magnitude > 400n ? magnitude : 400n
  const rounded = largest > 0n ? ((largest + step - 1n) / step) * step : step
  const maximum = ((rounded + 3n) / 4n) * 4n
  return {
    maximum,
    ratio: (value) => (value === null ? null : Number((value * 1_000_000n) / maximum) / 1_000_000),
  }
}

// Keep unavailable values as real gaps; connecting across them would suggest known earnings.
export function technicianLineSegments(points) {
  const segments = []
  let current = []
  for (const point of points) {
    if (point === null) {
      if (current.length) segments.push(current)
      current = []
    } else current.push(point)
  }
  if (current.length) segments.push(current)
  return segments
}

export function technicianInitials(name) {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}
