import { adminRequest } from '../../management/api/managementApi.js'

export function listPayments(query, token, signal) {
  return adminRequest(`/payments?${query}`, token, { signal })
}

export function getPayment(id, token, signal) {
  return adminRequest(`/payments/${encodeURIComponent(id)}`, token, { signal })
}
