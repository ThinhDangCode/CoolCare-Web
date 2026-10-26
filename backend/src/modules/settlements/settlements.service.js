import { writeAdminAudit } from '../audit/admin-audit.js'
import { AppError } from '../../utils.js'
import { validateSettlementId, validateSettlementListQuery, validateSettlementDetailQuery } from './settlements.validation.js'

export class SettlementsService {
  constructor(repository, { audit = writeAdminAudit } = {}) { this.repository = repository; this.audit = audit }
  async listSettlements(query, actorId) {
    const filters = validateSettlementListQuery(query)
    const result = await this.repository.listSettlements(filters)
    this.audit({ actorId, action: 'READ_LIST', entityType: 'SETTLEMENT', entityId: null, before: null,
      after: { hasSearch: Boolean(filters.search), status: filters.status, from: filters.from ?? null,
        to: filters.to ?? null, page: filters.page, limit: filters.limit,
        total: result.pagination.total, returned: result.items.length } })
    return result
  }
  async getSettlement(id, query, actorId) {
    const key = validateSettlementId(id)
    const filters = validateSettlementDetailQuery(query)
    const result = await this.repository.getSettlement(key, filters)
    if (!result) throw new AppError(404, 'SETTLEMENT_NOT_FOUND', 'Không tìm thấy kỳ đối soát.')
    this.audit({ actorId, action: 'READ_DETAIL', entityType: 'SETTLEMENT', entityId: result.id,
      before: null, after: { status: result.status, page: filters.page, limit: filters.limit,
        total: result.transactions.pagination.total, returned: result.transactions.items.length } })
    return result
  }
}
