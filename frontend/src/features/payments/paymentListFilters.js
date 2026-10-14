import { paymentMethods, paymentStatuses } from './paymentPresentation.js'

export const initialPaymentFilters = {
  search: '',
  status: 'ALL',
  method: 'ALL',
  from: '',
  to: '',
  page: 1,
  limit: 10,
}

export function validPaymentDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function readPaymentFilters(params) {
  const page = Number(params.get('page'))
  const limit = Number(params.get('limit'))
  let from = params.get('from') ?? ''
  let to = params.get('to') ?? ''
  if (from && !validPaymentDay(from)) from = ''
  if (to && !validPaymentDay(to)) to = ''
  if (from && to && from > to) {
    from = ''
    to = ''
  }
  return {
    search: (params.get('search') ?? '').trim().slice(0, 150),
    status: Object.hasOwn(paymentStatuses, params.get('status')) ? params.get('status') : 'ALL',
    method: Object.hasOwn(paymentMethods, params.get('method')) ? params.get('method') : 'ALL',
    from,
    to,
    page: Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1,
    limit: [10, 25, 50].includes(limit) ? limit : 10,
  }
}

export function writePaymentFilters(filters) {
  const params = new URLSearchParams()
  for (const key of ['search', 'status', 'method', 'from', 'to', 'page', 'limit']) {
    if (filters[key] && filters[key] !== initialPaymentFilters[key]) params.set(key, filters[key])
  }
  return params
}
