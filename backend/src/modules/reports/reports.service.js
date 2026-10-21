import { writeAdminAudit } from '../audit/admin-audit.js'
import { revenueUnits, revenueDecimal, roundedDivide, revenuePercent } from '../revenue/revenue.money.js'
import { validateReportsQuery } from './reports.validation.js'

function count(value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid reports count')
  return number
}
function money(value) {
  return value === null ? null : revenueDecimal(revenueUnits(value))
}

export function presentReports(period, report) {
  const { summary } = report
  const bookings = count(summary.bookings)
  const settledPayments = count(summary.settledPayments)
  const commissionAmount = money(summary.commissionAmount)
  const share = (value, total) => revenuePercent(BigInt(value), BigInt(total)) ?? 0
  return {
    period,
    asOf: report.asOf,
    summary: {
      bookings,
      customers: count(summary.customers),
      technicians: count(summary.technicians),
      commissionAmount,
      knownCommissionAmount: money(summary.knownCommissionAmount),
      settledPayments,
      missingCommissionPayments: count(summary.missingCommissionPayments),
      averageCommissionAmount: commissionAmount === null || settledPayments === 0
        ? null : revenueDecimal(roundedDivide(revenueUnits(commissionAmount), BigInt(settledPayments))),
    },
    bookingOverview: report.bookingOverview.map((item) => ({
      key: item.key, count: count(item.count), percentage: share(item.count, bookings),
    })),
    trend: report.trend.map((point) => ({
      date: point.date,
      bookings: count(point.bookings),
      commissionAmount: money(point.commissionAmount),
      knownCommissionAmount: money(point.knownCommissionAmount),
      settledPayments: count(point.settledPayments),
      missingCommissionPayments: count(point.missingCommissionPayments),
    })),
    services: {
      totalUses: count(report.services.totalUses),
      items: report.services.items.map((item) => ({
        id: item.id, name: item.name, count: count(item.count),
        percentage: share(item.count, report.services.totalUses),
      })),
    },
  }
}

export class ReportsService {
  constructor(repository, { audit = writeAdminAudit, now = () => new Date() } = {}) {
    this.repository = repository
    this.audit = audit
    this.now = now
  }

  async getReports(query, actorId) {
    const period = validateReportsQuery(query, this.now())
    const data = presentReports(period, await this.repository.readReports(period))
    this.audit({
      actorId, action: 'READ_REPORT', entityType: 'STATISTICAL_REPORT', entityId: null, before: null,
      after: { from: period.from, to: period.to, granularity: period.granularity, bookings: data.summary.bookings },
    })
    return data
  }
}
