const DAY = 86_400_000
const numberLocale = (locale) => (locale === 'vi' ? 'vi-VN' : 'en-US')
const integerFormat = (locale) =>
  new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 0 })

export function reportCount(value, locale = 'en') {
  if (value === null || value === undefined || !/^-?\d+$/.test(String(value))) return '—'
  return integerFormat(locale).format(BigInt(value))
}

export function reportMoney(value, locale = 'en') {
  if (reportMoneyUnits(value) === null) return '—'
  const text = String(value)
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  const decimals = fraction.padEnd(2, '0')
  const decimalPart = decimals === '00' ? '' : `${locale === 'vi' ? ',' : '.'}${decimals}`
  return `${text.startsWith('-') ? '-' : ''}${integerFormat(locale).format(BigInt(whole))}${decimalPart} ₫`
}

export const reportDate = (value) => value.split('-').reverse().join('/')

export function reportPercent(value, locale = 'en') {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)))
    return '—'
  return `${new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 1 }).format(value)}%`
}

export function reportTimestamp(value, locale = 'en') {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return '—'
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(time + 7 * 3_600_000))
}

export function reportErrorKey(error) {
  if (error?.status === 403) return 'You do not have permission to view reports.'
  if (error?.status === 422) return 'Check the report period and try again.'
  if (error?.message === 'Không thể kết nối máy chủ. Vui lòng thử lại.')
    return 'Unable to connect to the server. Please try again.'
  return 'Unable to load reports. Please try again.'
}

export function vietnamToday(now = new Date()) {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
}

function dateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date.getTime()
}

export function presetReportRange(preset = '30', today = vietnamToday()) {
  const end = dateTime(today)
  return {
    from:
      preset === 'YTD'
        ? `${today.slice(0, 4)}-01-01`
        : new Date(end - (Number(preset) - 1) * DAY).toISOString().slice(0, 10),
    to: today,
  }
}

export function reportRangeError({ from, to }) {
  const start = dateTime(from)
  const end = dateTime(to)
  if (start === null || end === null)
    return 'Choose valid start and end dates between 1900 and 9999.'
  if (start > end) return 'The start date must be on or before the end date.'
  if ((end - start) / DAY + 1 > 366) return 'Choose a report period of 366 days or fewer.'
  return ''
}

export function readReportRange(params, defaults) {
  if (!params.has('from') && !params.has('to')) return defaults
  return { from: params.get('from') ?? '', to: params.get('to') ?? '' }
}

export function reportRangeQuery(range) {
  return new URLSearchParams({ from: range.from, to: range.to }).toString()
}

export function reportRangePreset(range, today = vietnamToday()) {
  return (
    ['7', '30', '90', 'YTD'].find(
      (preset) => reportRangeQuery(presetReportRange(preset, today)) === reportRangeQuery(range)
    ) ?? 'CUSTOM'
  )
}

export function reportMoneyUnits(value) {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value)))
    return null
  const text = String(value)
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  return (
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (text.startsWith('-') ? -1n : 1n)
  )
}

export function reportChartSeries(rows, metric) {
  const values = rows.map((row) =>
    metric === 'commission' ? reportMoneyUnits(row.commissionAmount) : BigInt(row.bookings)
  )
  const largest = values.reduce(
    (maximum, value) => (value !== null && value > maximum ? value : maximum),
    0n
  )
  const baseline = metric === 'commission' ? 400n : 4n
  const magnitude = largest > 0n ? 10n ** BigInt(String(largest).length - 1) : 1n
  const step = magnitude > baseline ? magnitude : baseline
  const roundedMaximum = largest ? ((largest + step - 1n) / step) * step : baseline
  const maximum = ((roundedMaximum + 3n) / 4n) * 4n
  return {
    values,
    maximum,
    ratio: (value) => (value === null ? null : Number((value * 1_000_000n) / maximum) / 1_000_000),
  }
}

export function reportAxisLabel(units, metric, locale = 'en') {
  if (metric !== 'commission') return reportCount(units, locale)
  if (typeof units !== 'bigint') return '—'
  const magnitude = units < 0n ? -units : units
  const sign = units < 0n ? '-' : ''
  for (const [divisor, english, vietnamese] of [
    [100_000_000_000_000n, 'T', 'nghìn tỷ'],
    [100_000_000_000n, 'B', 'tỷ'],
    [100_000_000n, 'M', 'triệu'],
    [100_000n, 'K', 'nghìn'],
  ]) {
    if (magnitude >= divisor) {
      const scaled = (magnitude * 10n + divisor / 2n) / divisor
      const decimal = scaled % 10n ? `${locale === 'vi' ? ',' : '.'}${scaled % 10n}` : ''
      const suffix = locale === 'vi' ? ` ${vietnamese}` : english
      return `${sign}${integerFormat(locale).format(scaled / 10n)}${decimal}${suffix}`
    }
  }
  return reportMoney(
    `${sign}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`,
    locale
  ).replace(' ₫', '')
}

export function reportBucketLabel(date, granularity) {
  return granularity === 'month'
    ? `${date.slice(5, 7)}/${date.slice(0, 4)}`
    : `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

export function reportServiceRows(services) {
  if (services.items.length <= 4) return services.items
  const rest = services.items.slice(4).reduce((sum, row) => sum + row.count, 0)
  return [
    ...services.items.slice(0, 4),
    {
      id: 'other-services',
      name: 'Other services',
      count: rest,
      percentage: services.totalUses ? (rest * 100) / services.totalUses : 0,
    },
  ]
}
