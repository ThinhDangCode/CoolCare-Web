import { writeAdminAudit as writeManagementAudit } from '../audit/admin-audit.js'
import { AppError } from '../../utils.js'
import { validateRevenueExportQuery } from './payments.export.validation.js'
import { buildRevenueWorkbook } from './payments.export.workbook.js'
import { REPORT_ROW_LIMIT } from './payments.export.constants.js'

export class PaymentsExportService {
  constructor(repository, { audit = writeManagementAudit, buildWorkbook = buildRevenueWorkbook } = {}) {
    this.repository = repository
    this.audit = audit
    this.buildWorkbook = buildWorkbook
  }

  async exportRevenue(query, actorId) {
    const filters = validateRevenueExportQuery(query)
    const report = await this.repository.readRevenueReport(filters)
    if (report.rowCount > REPORT_ROW_LIMIT) throw new AppError(422, 'REPORT_TOO_LARGE', 'Báo cáo vượt quá 10.000 giao dịch. Vui lòng thu hẹp bộ lọc.')
    if (report.rows.length !== report.rowCount) throw new Error('Report snapshot count does not match rows')
    const buffer = await this.buildWorkbook(report, filters)
    this.audit({ actorId, action: 'EXPORT', entityType: 'PAYMENT', entityId: null, before: null,
      after: { from: filters.from, to: filters.to, method: filters.method, hasSearch: Boolean(filters.search), count: report.rowCount },
    })
    return { buffer, rowCount: report.rowCount, filename: `coolcare-revenue-${filters.from}-${filters.to}.xlsx` }
  }
}
