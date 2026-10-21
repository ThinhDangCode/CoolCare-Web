import { adminRequest } from '../../../shared/api/adminApi.js'

export function getTechnicianStatistics(query, token, signal) {
  return adminRequest(`/technician-statistics?${query}`, token, { signal })
}
