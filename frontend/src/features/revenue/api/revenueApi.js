import { adminRequest } from '../../management/api/managementApi.js'

export function getRevenue(query, token, signal) {
  return adminRequest(`/revenue?${query}`, token, { signal })
}
