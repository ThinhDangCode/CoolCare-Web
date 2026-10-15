import { withdrawalStatuses } from './withdrawalPresentation.js'

export const initialWithdrawalFilters = {
  search: '',
  status: 'ALL',
  from: '',
  to: '',
  page: 1,
  limit: 10,
}

export function validWithdrawalDay(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number(value.slice(0, 4)) < 1
  )
    return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function withdrawalRangeError({ from, to }) {
  if ((from && !validWithdrawalDay(from)) || (to && !validWithdrawalDay(to)))
    return 'Choose valid dates from 0001 to 9999.'
  if (from && to && from > to) return 'To date must be on or after From date.'
  return ''
}

export function currentWithdrawalMonth(now = new Date()) {
  const calendar = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const year = calendar.getUTCFullYear()
  const month = calendar.getUTCMonth() + 1
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const lastDay = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  return { from: `${prefix}-01`, to: `${prefix}-${lastDay}` }
}

export function readWithdrawalFilters(params) {
  let from = params.get('from') ?? ''
  let to = params.get('to') ?? ''
  if (withdrawalRangeError({ from, to })) {
    from = ''
    to = ''
  }
  const page = params.get('page')
  const limit = params.get('limit')
  return {
    search: (params.get('search') ?? '')
      .trim()
      .split('')
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join('')
      .slice(0, 150),
    status: Object.hasOwn(withdrawalStatuses, params.get('status')) ? params.get('status') : 'ALL',
    from,
    to,
    page:
      /^\d+$/.test(page ?? '') && Number(page) >= 1 && Number(page) <= 1000000 ? Number(page) : 1,
    limit: [10, 25, 50, 100].includes(Number(limit)) ? Number(limit) : 10,
  }
}

export function writeWithdrawalFilters(filters) {
  const params = new URLSearchParams()
  for (const key of ['search', 'status', 'from', 'to', 'page', 'limit']) {
    if (filters[key] && filters[key] !== initialWithdrawalFilters[key])
      params.set(key, filters[key])
  }
  return params
}

export const displayWithdrawalDay = (value) => value.split('-').reverse().join('/')

export function withdrawalRangeLabel({ from, to }) {
  if (!from && !to) return 'All time'
  return `${from ? displayWithdrawalDay(from) : 'Any date'} – ${to ? displayWithdrawalDay(to) : 'Any date'}`
}
