import { writeAdminAudit } from '../audit/admin-audit.js'
import { revenuePercent, roundedDivide } from '../revenue/revenue.money.js'
import { validateCustomerStatisticsQuery } from './customer-statistics.validation.js'

function count(value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid customer statistics count')
  return number
}
const percent = (value, total) => revenuePercent(BigInt(value), BigInt(total))
const average = (value, total) => total > 0 ? Number(roundedDivide(BigInt(value) * 100n, BigInt(total))) / 100 : null
const growth = (current, previous) => percent(BigInt(current) - BigInt(previous), previous)

export function presentCustomerStatistics(query, raw) {
  const period = { from: query.from, to: query.to, timeZone: query.timeZone, granularity: query.granularity }
  const summary = Object.fromEntries(Object.entries(raw.summary).map(([key, value]) => [key, count(value)]))
  const acquisition = { ...raw.acquisition,
    currentCount: count(raw.acquisition.currentCount), previousCount: count(raw.acquisition.previousCount),
    monthCount: count(raw.acquisition.monthCount), yearCount: count(raw.acquisition.yearCount),
    trend: raw.acquisition.trend.map((item) => ({ date: item.date, count: count(item.count) })),
  }
  acquisition.growthPercent = growth(acquisition.currentCount, acquisition.previousCount)
  const areas = raw.areas.map((item) => ({ ...item,
    count: count(item.count), newCount: count(item.newCount), previousNewCount: count(item.previousNewCount),
    percentage: percent(item.count, summary.totalCustomers) ?? 0,
    growthPercent: growth(item.newCount, item.previousNewCount),
  }))
  const knownAreas = areas.filter((item) => !item.missing)
  const knownCustomers = knownAreas.reduce((total, item) => total + item.count, 0)
  const totalBookings = count(raw.usage.totalBookings)
  const distinctCustomers = count(raw.usage.distinctCustomers)
  const totalUses = count(raw.usage.totalUses)
  const repeatCustomers = count(raw.usage.repeatCustomers)
  const usage = { totalBookings, distinctCustomers, totalUses, repeatCustomers,
    averageBookingsPerCustomer: average(totalBookings, distinctCustomers),
    repeatCustomerPercent: percent(repeatCustomers, distinctCustomers),
    services: raw.usage.services.map((item) => ({ ...item, count: count(item.count),
      customers: count(item.customers), bookings: count(item.bookings), percentage: percent(item.count, totalUses) ?? 0 })),
    categories: raw.usage.categories.map((item) => ({ ...item, count: count(item.count), percentage: percent(item.count, totalUses) ?? 0 })),
  }
  usage.topService = usage.services[0] ?? null
  const cancellations = { totalBookings: count(raw.cancellations.totalBookings),
    cancelledBookings: count(raw.cancellations.cancelledBookings), rejectedBookings: count(raw.cancellations.rejectedBookings),
    affectedBookings: count(raw.cancellations.affectedBookings),
    trend: raw.cancellations.trend.map((item) => ({ date: item.date, totalBookings: count(item.totalBookings),
      cancelledBookings: count(item.cancelledBookings), rejectedBookings: count(item.rejectedBookings) })),
  }
  cancellations.cancellationPercent = percent(cancellations.cancelledBookings, cancellations.totalBookings)
  cancellations.rejectionPercent = percent(cancellations.rejectedBookings, cancellations.totalBookings)
  return { period, asOf: raw.asOf, summary, acquisition,
    areas: { totalCustomers: summary.totalCustomers, knownCustomers,
      unknownCustomers: summary.totalCustomers - knownCustomers, areaCount: knownAreas.length,
      averageCustomersPerArea: average(knownCustomers, knownAreas.length), topArea: knownAreas[0] ?? null,
      fastestGrowingArea: [...knownAreas].filter((item) => item.growthPercent !== null && item.growthPercent > 0)
        .sort((a, b) => b.growthPercent - a.growthPercent || b.newCount - a.newCount || a.key.localeCompare(b.key))[0] ?? null,
      items: areas },
    usage, cancellations, locked: { items: raw.locked.items, total: count(raw.locked.total), page: query.page, limit: query.limit } }
}

export class CustomerStatisticsService {
  constructor(repository, { audit = writeAdminAudit, now = () => new Date() } = {}) {
    this.repository = repository
    this.audit = audit
    this.now = now
  }

  async getCustomerStatistics(query, actorId) {
    const validated = validateCustomerStatisticsQuery(query, this.now())
    const data = presentCustomerStatistics(validated, await this.repository.readCustomerStatistics(validated))
    this.audit({ actorId, action: 'READ_REPORT', entityType: 'CUSTOMER_STATISTICS', entityId: null, before: null,
      after: { from: validated.from, to: validated.to, granularity: validated.granularity,
        page: validated.page, limit: validated.limit, totalCustomers: data.summary.totalCustomers } })
    return data
  }
}
