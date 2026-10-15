import {
  currentWithdrawalMonth,
  initialWithdrawalFilters,
  readWithdrawalFilters,
  withdrawalRangeError,
  withdrawalRangeLabel,
} from '../withdrawals/withdrawalFilters.js'
import { validTopupId } from './topupPresentation.js'

export const initialTopupFilters = { ...initialWithdrawalFilters, method: 'ALL' }
export const currentTopupMonth = currentWithdrawalMonth
export const topupRangeError = withdrawalRangeError
export const topupRangeLabel = withdrawalRangeLabel

export function readTopupFilters(params) {
  const method = params.get('method') ?? 'ALL'
  return {
    ...readWithdrawalFilters(params),
    method: validTopupId(method) ? method.toLowerCase() : method,
  }
}

export function writeTopupFilters(filters) {
  const params = new URLSearchParams()
  for (const key of ['search', 'status', 'method', 'from', 'to', 'page', 'limit']) {
    if (key === 'method') {
      if (filters.method !== 'ALL') params.set(key, filters.method)
    } else if (filters[key] && filters[key] !== initialTopupFilters[key]) {
      params.set(key, filters[key])
    }
  }
  return params
}
