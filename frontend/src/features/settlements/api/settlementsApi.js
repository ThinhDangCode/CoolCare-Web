import { adminRequest } from '../../../shared/api/adminApi.js'

export function listSettlements(query, token, signal) {
  return adminRequest(`/settlements?${query}`, token, { signal })
}

export function getSettlement(id, page, limit, token, signal) {
  const query = new URLSearchParams({ transactionsPage: page, transactionsLimit: limit })
  return adminRequest(`/settlements/${encodeURIComponent(id)}?${query}`, token, { signal })
}
