import { writeManagementAudit } from '../management/management.audit.js'
import { AppError } from '../../utils.js'
import {
  validateWithdrawalId,
  validateWithdrawalListQuery,
  validateWithdrawalDetailQuery,
} from './withdrawals.validation.js'

export class WithdrawalsService {
  constructor(repository, { audit = writeManagementAudit } = {}) {
    this.repository = repository
    this.audit = audit
  }
  async listWithdrawals(query, actorId) {
    const filters = validateWithdrawalListQuery(query)
    const result = await this.repository.listWithdrawals(filters)
    this.audit({
      actorId,
      action: 'READ_LIST',
      entityType: 'WITHDRAWAL',
      entityId: null,
      before: null,
      after: {
        hasSearch: Boolean(filters.search),
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
  async getWithdrawal(id, actorId, query = {}) {
    const validId = validateWithdrawalId(id)
    validateWithdrawalDetailQuery(query)
    const result = await this.repository.getWithdrawal(validId)
    if (!result)
      throw new AppError(404, 'WITHDRAWAL_NOT_FOUND', 'Không tìm thấy giao dịch rút tiền.')
    this.audit({
      actorId,
      action: 'READ_DETAIL',
      entityType: 'WITHDRAWAL',
      entityId: result.id,
      before: null,
      after: { status: result.status },
    })
    return result
  }
}
