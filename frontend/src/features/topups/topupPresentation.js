export {
  formatWithdrawalAmount as formatTopupAmount,
  formatWithdrawalDate as formatTopupDate,
  formatWithdrawalTime as formatTopupTime,
  validWithdrawalId as validTopupId,
  withdrawalStatuses as topupStatuses,
  withdrawalText as topupText,
} from '../withdrawals/withdrawalPresentation.js'

export const topupReference = (topup) =>
  topup.topupCode || `${topup.id.slice(0, 8)}…${topup.id.slice(-4)}`
export const topupMethodName = (method) => method?.name || method?.code || '—'
