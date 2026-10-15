import { defaultRevenuePeriod } from '../payments/revenueReport.js'

export function defaultRevenueFilters(now = new Date()) {
  const period = defaultRevenuePeriod(now)
  return {
    period: 'MONTH',
    year: period.year,
    month: period.month,
    quarter: period.quarter,
    service: 'ALL',
    area: 'ALL',
  }
}

export function readRevenueFilters(params, defaults = defaultRevenueFilters()) {
  const period = params.get('period') ?? defaults.period
  const month = (params.get('month') ?? defaults.month).slice(0, 4)
  const quarter =
    params.get('quarter') ??
    (/^\d{1,2}$/.test(month) && Number(month) >= 1 && Number(month) <= 12
      ? String(Math.ceil(Number(month) / 3))
      : defaults.quarter)
  return {
    ...defaults,
    period: ['MONTH', 'QUARTER', 'YEAR'].includes(period) ? period : defaults.period,
    year: (params.get('year') ?? defaults.year).slice(0, 8),
    month,
    quarter: quarter.slice(0, 4),
    service: (params.get('service') || 'ALL').slice(0, 200),
    area: (params.get('area') || 'ALL').slice(0, 200),
  }
}

export function revenueFilterError(filters) {
  if (!/^\d{4}$/.test(filters.year) || Number(filters.year) < 1900)
    return 'Choose a year from 1900 to 9999.'
  if (
    filters.period === 'MONTH' &&
    (!/^\d{1,2}$/.test(filters.month) || Number(filters.month) < 1 || Number(filters.month) > 12)
  )
    return 'Choose a valid month.'
  if (filters.period === 'QUARTER' && !/^[1-4]$/.test(filters.quarter))
    return 'Choose a quarter from Q1 to Q4.'
  return ''
}

export function writeRevenueFilters(filters) {
  const params = new URLSearchParams({ period: filters.period, year: filters.year })
  if (filters.period === 'MONTH') params.set('month', filters.month)
  if (filters.period === 'QUARTER') params.set('quarter', filters.quarter)
  if (filters.service !== 'ALL') params.set('service', filters.service)
  if (filters.area !== 'ALL') params.set('area', filters.area)
  return params
}
