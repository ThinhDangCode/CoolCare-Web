import { writeAdminAudit } from '../audit/admin-audit.js'
import { revenueDecimal, revenuePercent, revenueUnits, roundedDivide } from '../revenue/revenue.money.js'
import { validateTechnicianStatisticsQuery } from './technician-statistics.validation.js'

function count(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid technician statistics count')
  return result
}
const counts = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, count(value)]))
const percent = (value, total) => revenuePercent(BigInt(value), BigInt(total))
const average = (sum, total) => total > 0 ? Number(roundedDivide(BigInt(sum) * 100n, BigInt(total))) / 100 : null
function money(value) {
  const units = revenueUnits(value)
  if (units < 0n) throw new Error('Invalid technician statistics amount')
  return revenueDecimal(units)
}
function incomeRow(row) {
  const knownAmount = money(row.knownAmount)
  const missingPayments = count(row.missingPayments)
  return { knownAmount, missingPayments, amount: missingPayments > 0 ? null : knownAmount }
}
function activityRow(raw) {
  const { ratingSum, ...rest } = raw
  const result = counts(rest)
  const sum = count(ratingSum)
  if (sum < result.reviewCount || sum > result.reviewCount * 5) throw new Error('Invalid technician statistics rating')
  return { ...result, averageRating: average(sum, result.reviewCount) }
}

export function presentTechnicianStatistics(query, raw) {
  const summary = counts(raw.summary)
  const incomeTotals = incomeRow(raw.income)
  const earningTechnicians = count(raw.income.earningTechnicians)
  const rankedIncome = raw.income.technicians.map((row) => ({ id: row.id, name: row.name, ...incomeRow(row) }))
    .sort((left, right) => {
      const a = revenueUnits(left.knownAmount), b = revenueUnits(right.knownAmount)
      return a === b ? left.id.localeCompare(right.id) : a > b ? -1 : 1
    })
  const winner = incomeTotals.missingPayments > 0 ? null : rankedIncome[0]
  const income = { ...incomeTotals, earningTechnicians,
    settledPayments: count(raw.income.settledPayments), completedJobs: count(raw.income.completedJobs),
    averageAmount: incomeTotals.amount !== null && earningTechnicians > 0
      ? revenueDecimal(roundedDivide(revenueUnits(incomeTotals.amount), BigInt(earningTechnicians))) : null,
    topTechnician: winner ? { id: winner.id, name: winner.name, amount: winner.amount, knownAmount: winner.knownAmount } : null,
    trend: raw.income.trend.map((row) => ({ date: row.date, ...incomeRow(row), settledPayments: count(row.settledPayments) })),
  }
  const areaItems = raw.areas.items.map((row) => ({ ...row, count: count(row.count),
    percentage: percent(row.count, summary.totalTechnicians) ?? 0 }))
  const coveredTechnicians = count(raw.areas.coveredTechnicians)
  const coverageAssignments = count(areaItems.reduce((sum, row) => sum + row.count, 0))
  const areas = { areaCount: areaItems.length, totalTechnicians: summary.totalTechnicians, coveredTechnicians,
    unassignedTechnicians: count(summary.totalTechnicians - coveredTechnicians), coverageAssignments,
    averageTechniciansPerArea: average(coverageAssignments, areaItems.length), topArea: areaItems[0] ?? null, items: areaItems }
  const { trend, ...activityTotals } = raw.activity
  const activity = { ...activityRow(activityTotals),
    completionPercent: percent(raw.activity.completedRequests, raw.activity.totalRequests),
    trend: trend.map(({ date, ...row }) => ({ date, ...activityRow(row) })),
  }
  const { trend: issuesTrend, ...issueTotals } = raw.issues
  const issues = { ...counts(issueTotals),
    totalIssues: count(count(raw.issues.complaints) + count(raw.issues.penalties)),
    trend: issuesTrend.map(({ date, ...row }) => ({ date, ...counts(row) })),
  }
  return { period: { from: query.from, to: query.to, timeZone: query.timeZone, granularity: query.granularity },
    asOf: raw.asOf, summary, income, areas, activity, issues,
    locked: { items: raw.locked.items, total: count(raw.locked.total), page: query.page, limit: query.limit } }
}

export class TechnicianStatisticsService {
  constructor(repository, { audit = writeAdminAudit, now = () => new Date() } = {}) {
    this.repository = repository
    this.audit = audit
    this.now = now
  }

  async getTechnicianStatistics(query, actorId) {
    const validated = validateTechnicianStatisticsQuery(query, this.now())
    const data = presentTechnicianStatistics(validated, await this.repository.readTechnicianStatistics(validated))
    this.audit({ actorId, action: 'READ_REPORT', entityType: 'TECHNICIAN_STATISTICS', entityId: null, before: null,
      after: { from: validated.from, to: validated.to, granularity: validated.granularity,
        page: validated.page, limit: validated.limit, totalTechnicians: data.summary.totalTechnicians } })
    return data
  }
}
