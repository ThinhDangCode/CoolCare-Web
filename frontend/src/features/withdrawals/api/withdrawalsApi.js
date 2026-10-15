import { adminRequest } from '../../management/api/managementApi.js'

export function listWithdrawals(query, token, signal) {
  return adminRequest(`/withdrawals?${query}`, token, { signal })
}

export function getWithdrawal(id, token, signal) {
  return adminRequest(`/withdrawals/${encodeURIComponent(id)}`, token, { signal })
}
