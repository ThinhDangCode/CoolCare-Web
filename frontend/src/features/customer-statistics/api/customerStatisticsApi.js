import { adminRequest } from '../../../shared/api/adminApi.js'

export function getCustomerStatistics(query, token, signal) {
  return adminRequest(`/customer-statistics?${query}`, token, { signal })
}
