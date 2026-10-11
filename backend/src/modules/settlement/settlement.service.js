import { AppError } from '../../utils.js'
import { validateWithdrawalId, validateWithdrawalListQuery } from './settlement.validation.js'

export class SettlementService {
  constructor(repository) {
    this.repository = repository
  }

  listWithdrawals(query) {
    return this.repository.listWithdrawals(validateWithdrawalListQuery(query))
  }

  async getWithdrawal(id) {
    const withdrawal = await this.repository.getWithdrawal(validateWithdrawalId(id))
    if (!withdrawal) {
      throw new AppError(404, 'WITHDRAWAL_NOT_FOUND', 'Không tìm thấy yêu cầu rút tiền.')
    }
    return withdrawal
  }
}
