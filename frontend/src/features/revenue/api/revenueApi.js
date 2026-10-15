import { adminRequest } from '../../../shared/api/adminApi.js'

export function getRevenue(query, token, signal) {
  return adminRequest(`/revenue?${query}`, token, { signal })
}
