import { writeManagementAudit } from '../management/management.audit.js'
import { AppError } from '../../utils.js'
import {
  validateTopupId,
  validateTopupListQuery,
  validateTopupDetailQuery,
} from './topups.validation.js'

export class TopupsService {
  constructor(repository, { audit = writeManagementAudit } = {}) {
    this.repository = repository
    this.audit = audit
  }
  async listTopups(query, actorId) {
    const filters = validateTopupListQuery(query)
    const result = await this.repository.listTopups(filters)
    this.audit({
      actorId,
      action: 'READ_LIST',
      entityType: 'TOPUP',
      entityId: null,
      before: null,
      after: {
        hasSearch: Boolean(filters.search),
        hasMethodFilter: filters.method !== 'ALL',
        status: filters.status,
        from: filters.from ?? null,
        to: filters.to ?? null,
        page: filters.page,
        limit: filters.limit,
        total: result.pagination.total,
        returned: result.items.length,
      },
    })
    return result
  }
  async getTopup(id, actorId, query = {}) {
    const validId = validateTopupId(id)
    validateTopupDetailQuery(query)
    const result = await this.repository.getTopup(validId)
    if (!result) throw new AppError(404, 'TOPUP_NOT_FOUND', 'Không tìm thấy giao dịch nạp tiền.')
    this.audit({
      actorId,
      action: 'READ_DETAIL',
      entityType: 'TOPUP',
      entityId: result.id,
      before: null,
      after: { status: result.status },
    })
    return result
  }
}
