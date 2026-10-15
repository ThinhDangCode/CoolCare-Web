import { writeAdminAudit as writeManagementAudit } from '../audit/admin-audit.js'
import { validateRevenueQuery, calendarMonthDays } from './revenue.validation.js'
import { revenueUnits, revenueDecimal, roundedDivide, revenuePercent } from './revenue.money.js'

const empty = {
  amount: '0.00',
  knownAmount: '0.00',
  paymentCount: '0',
  missingCommissionCount: '0',
  unknownCount: '0',
  unallocatedCount: '0',
  unclassifiedCount: '0',
}
function count(value) {
  const number = Number(value ?? 0)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid report count')
  return number
}
function money(value) {
  return value === null ? null : revenueDecimal(revenueUnits(value))
}
function distribution(rows, kind, total) {
  return rows
    .filter((row) => row.kind === kind && row.period === 'CURRENT')
    .map((row) => ({
      id: row.key,
      name: row.label,
      amount: money(row.amount),
      knownAmount: money(row.knownAmount),
      sharePercent:
        row.amount === null || total === null
          ? null
          : revenuePercent(revenueUnits(row.amount), revenueUnits(total)),
    }))
    .sort((a, b) => {
      const difference = revenueUnits(b.knownAmount) - revenueUnits(a.knownAmount)
      return difference > 0n ? 1 : difference < 0n ? -1 : a.id.localeCompare(b.id)
    })
}

export function presentRevenueReport(request, report) {
  const { period, filters } = request
  const current =
    report.rows.find((row) => row.kind === 'SUMMARY' && row.period === 'CURRENT') ?? empty
  const previous =
    report.rows.find((row) => row.kind === 'SUMMARY' && row.period === 'PREVIOUS') ?? empty
  const totalRevenue = money(current.amount)
  const previousRevenue = money(previous.amount)
  const services = distribution(report.rows, 'SERVICE', totalRevenue)
  const areas = distribution(report.rows, 'AREA', totalRevenue)
  const top = (items) =>
    totalRevenue !== null &&
    revenueUnits(totalRevenue) > 0n &&
    items.length &&
    items.every((item) => item.amount !== null)
      ? {
          id: items[0].id,
          name: items[0].name,
          amount: items[0].amount,
          sharePercent: items[0].sharePercent,
        }
      : null
  const fromParts = period.from.split('-').map(Number)
  const previousParts = period.previousFrom.split('-').map(Number)
  const currentSize =
    period.type === 'MONTH' ? calendarMonthDays(fromParts[0], fromParts[1]) : period.monthCount
  const previousSize =
    period.type === 'MONTH'
      ? calendarMonthDays(previousParts[0], previousParts[1])
      : period.monthCount
  const trendRows = new Map(
    report.rows
      .filter((row) => row.kind === 'TREND')
      .map((row) => [`${row.period}:${row.key}`, row])
  )
  const trend = Array.from({ length: Math.max(currentSize, previousSize) }, (_, index) => {
    const ordinal = index + 1
    const point = trendRows.get(`CURRENT:${ordinal}`) ?? empty
    const previousPoint = trendRows.get(`PREVIOUS:${ordinal}`) ?? empty
    const currentMonth = fromParts[1] + index
    const label =
      period.type === 'MONTH'
        ? `Day ${String(ordinal).padStart(2, '0')}`
        : new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(
            new Date(`${fromParts[0]}-${String(currentMonth).padStart(2, '0')}-01T00:00:00Z`)
          )
    return {
      key: String(ordinal),
      label,
      amount: ordinal > currentSize ? null : money(point.amount),
      knownAmount: ordinal > currentSize ? null : money(point.knownAmount),
      previousAmount: ordinal > previousSize ? null : money(previousPoint.amount),
    }
  })
  const warnings = []
  const warn = (code, message, value) => {
    if (count(value)) warnings.push({ code, message, count: count(value) })
  }
  warn(
    'MISSING_COMMISSION',
    'Some successful settled payments have no saved commission. Their revenue is unknown.',
    current.missingCommissionCount
  )
  warn(
    'UNALLOCATED_COMMISSION',
    'Some payments cannot be allocated because approved line totals do not match the saved commission base or the base is invalid. Their commission remains in Unallocated commission.',
    current.unallocatedCount
  )
  warn(
    'UNCLASSIFIED_LABOR',
    'Some approved labor or service lines have no linked service. Their share is shown in Unclassified labor / service.',
    current.unclassifiedCount
  )
  if (filters.service !== 'ALL' && filters.service !== 'UNALLOCATED')
    warn(
      'SERVICE_ALLOCATION_UNCERTAIN',
      'Unallocated payments may belong to the selected service. The known share is partial; the complete revenue is unavailable.',
      current.unallocatedCount
    )
  warn(
    'PREVIOUS_PERIOD_INCOMPLETE',
    'The comparison period contains unknown revenue; comparison percentage is unavailable.',
    previous.unknownCount
  )
  return {
    period,
    filters,
    options: report.options,
    summary: {
      totalRevenue,
      knownRevenue: money(current.knownAmount),
      missingCommissionCount: count(current.missingCommissionCount),
      averageMonthlyRevenue:
        totalRevenue === null
          ? null
          : revenueDecimal(roundedDivide(revenueUnits(totalRevenue), BigInt(period.monthCount))),
      comparisonPercent:
        totalRevenue === null || previousRevenue === null
          ? null
          : revenuePercent(
              revenueUnits(totalRevenue) - revenueUnits(previousRevenue),
              revenueUnits(previousRevenue)
            ),
      paymentCount: count(current.paymentCount),
      topService: top(services),
      topArea: top(areas),
    },
    trend,
    services,
    areas,
    warnings,
  }
}

export class RevenueService {
  constructor(repository, { audit = writeManagementAudit } = {}) {
    this.repository = repository
    this.audit = audit
  }
  async getRevenueReport(query, actorId) {
    const request = validateRevenueQuery(query)
    const data = presentRevenueReport(request, await this.repository.readRevenueReport(request))
    this.audit({
      actorId,
      action: 'READ_REPORT',
      entityType: 'REVENUE',
      entityId: null,
      before: null,
      after: {
        period: request.period.type,
        from: request.period.from,
        to: request.period.to,
        hasServiceFilter: request.filters.service !== 'ALL',
        hasAreaFilter: request.filters.area !== 'ALL',
        count: data.summary.paymentCount,
      },
    })
    return data
  }
}
