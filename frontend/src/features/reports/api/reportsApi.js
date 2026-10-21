import { adminRequest } from '../../../shared/api/adminApi.js'

export function getReports(query, token, signal) {
  return adminRequest(`/reports?${query}`, token, { signal })
}
