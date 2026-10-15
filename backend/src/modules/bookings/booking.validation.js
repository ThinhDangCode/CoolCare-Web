import { AppError, validateUuid } from '../../utils.js'

export const bookingStatuses = ['PENDING', 'TECHNICIAN_SELECTED', 'ACCEPTED', 'IN_PROGRESS',
  'WAITING_QUOTATION', 'QUOTATION_SENT', 'QUOTATION_ACCEPTED', 'QUOTATION_REJECTED',
  'WAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED']
const invalid = message => { throw new AppError(422, 'VALIDATION_ERROR', message) }
export function validateBookingQuery(query) {
  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? 10 : Number(query.limit)
  if (!Number.isInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(limit) || limit < 1 || limit > 100) invalid('Invalid page or page size.')
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 150)) invalid('Search must contain at most 150 characters.')
  const status = query.status ?? 'ALL'
  if (!['ALL', ...bookingStatuses].includes(status)) invalid('Invalid booking status.')
  const month = query.month ?? ''
  if (typeof month !== 'string' || (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) invalid('Choose a valid month.')
  const service = query.service ? validateUuid(query.service) : ''
  return { page, limit, search: (query.search || '').trim(), status, service, month }
}
