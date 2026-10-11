import { adminRequest } from '../../management/api/managementApi.js'

export function listWithdrawals(query, token, signal) {
  return adminRequest(`/settlement/withdrawals?${query}`, token, { signal })
}

export function getWithdrawal(id, token, signal) {
  return adminRequest(`/settlement/withdrawals/${encodeURIComponent(id)}`, token, { signal })
}
