import assert from 'node:assert/strict'
import test from 'node:test'
import {
  initialSettlementFilters,
  readSettlementFilters,
  settlementApiQuery,
  settlementMonthRange,
  settlementPeriodLabel,
  settlementRangeError,
  writeSettlementFilters,
} from './settlementFilters.js'
import {
  formatSettlementAmount,
  formatSettlementDate,
  formatSettlementPeriod,
  formatSettlementTime,
  settlementAmountTone,
  settlementErrorMessage,
  settlementSourceUrl,
  technicianInitials,
} from './settlementPresentation.js'

const now = new Date('2026-09-30T17:01:00Z')
const id = '86ed4c92-800f-8679-8576-ed65a4d29055'

test('defaults use the current month in Vietnam, including a UTC month boundary', () => {
  assert.deepEqual(initialSettlementFilters(now), {
    search: '',
    status: 'ALL',
    from: '2026-10-01',
    to: '2026-10-31',
    page: 1,
    limit: 10,
  })
})

test('month selection handles leap days and refuses invalid months', () => {
  assert.deepEqual(settlementMonthRange('2024', '02'), { from: '2024-02-01', to: '2024-02-29' })
  assert.deepEqual(settlementMonthRange('2026', '02'), { from: '2026-02-01', to: '2026-02-28' })
  assert.equal(settlementMonthRange('2026', '13'), null)
})

test('filter URLs round trip search, status, range and pagination', () => {
  const filters = {
    search: 'Nguyễn Văn %_A',
    status: 'OVERDUE',
    from: '2026-10-05',
    to: '2026-10-25',
    page: 2,
    limit: 25,
  }
  assert.deepEqual(readSettlementFilters(writeSettlementFilters(filters), now), filters)
  const query = new URLSearchParams(settlementApiQuery(filters))
  assert.equal(query.get('search'), filters.search)
  assert.equal(query.get('status'), 'OVERDUE')
  assert.equal(query.get('page'), '2')
})

test('all time survives a reload but is not sent as an unsupported API parameter', () => {
  const filters = { ...initialSettlementFilters(now), from: '', to: '' }
  assert.equal(writeSettlementFilters(filters).get('period'), 'all')
  assert.deepEqual(readSettlementFilters(writeSettlementFilters(filters), now), filters)
  const query = new URLSearchParams(settlementApiQuery(filters))
  assert.equal(query.has('period'), false)
  assert.equal(query.has('from'), false)
  assert.equal(query.get('page'), '1')
  assert.equal(query.get('limit'), '10')
})

test('malformed URL dates and reversed ranges fall back to safe monthly defaults', () => {
  for (const query of [
    'from=2026-02-30&to=2026-03-01',
    'from=2026-10-10&to=2026-10-01',
    'from=bad',
  ]) {
    const filters = readSettlementFilters(new URLSearchParams(query), now)
    assert.equal(filters.from, '2026-10-01')
    assert.equal(filters.to, '2026-10-31')
  }
  assert.equal(
    settlementRangeError({ from: '2026-02-29', to: '' }),
    'Enter valid dates in YYYY-MM-DD format.'
  )
  assert.equal(
    settlementRangeError({ from: '2026-10-02', to: '2026-10-01' }),
    'To date must be on or after From date.'
  )
})

test('single-sided custom ranges are retained and range labels explain missing bounds', () => {
  const filters = readSettlementFilters(new URLSearchParams('from=2026-10-05'), now)
  assert.equal(filters.from, '2026-10-05')
  assert.equal(filters.to, '')
  assert.equal(settlementPeriodLabel(filters), '05/10/2026 – Any date')
  assert.equal(settlementPeriodLabel({ from: '', to: '' }), 'All time')
  assert.equal(settlementPeriodLabel(initialSettlementFilters(now)), '10/2026')
})

test('URL statuses, pagination, control characters and search length are bounded', () => {
  const query = new URLSearchParams({
    search: ` \n${'x'.repeat(160)}\u0000`,
    status: 'INVALID',
    page: '1000001',
    limit: '7',
  })
  const filters = readSettlementFilters(query, now)
  assert.equal(filters.search, 'x'.repeat(150))
  assert.equal(filters.status, 'ALL')
  assert.equal(filters.page, 1)
  assert.equal(filters.limit, 10)
  assert.equal(
    readSettlementFilters(new URLSearchParams('status=OPEN&page=1000000&limit=50'), now).page,
    1_000_000
  )
  assert.equal(readSettlementFilters(new URLSearchParams('page=1.5'), now).page, 1)
})

test('money preserves values beyond Number precision and two decimal places', () => {
  assert.equal(formatSettlementAmount('9999999999999999.25', 'vi'), '9.999.999.999.999.999,25 ₫')
  assert.equal(formatSettlementAmount('-1234.50', 'en'), '−1,234.50 ₫')
  assert.equal(formatSettlementAmount('1234.50', 'vi', true), '+1.234,50 ₫')
  assert.equal(formatSettlementAmount('0.00', 'vi', true), '0 ₫')
  assert.equal(formatSettlementAmount('-0.00', 'vi', true), '0 ₫')
  assert.equal(formatSettlementAmount('0.01', 'en', true), '+0.01 ₫')
})

test('numeric-only table amounts preserve exact values, locale, signs and zero', () => {
  for (const [locale, large, debit, credit] of [
    ['vi', '9.999.999.999.999.999,25', '−1.234,50', '+0,01'],
    ['en', '9,999,999,999,999,999.25', '−1,234.50', '+0.01'],
  ]) {
    assert.equal(formatSettlementAmount('9999999999999999.25', locale, false, false), large)
    assert.equal(formatSettlementAmount('-1234.50', locale, true, false), debit)
    assert.equal(formatSettlementAmount('0.01', locale, true, false), credit)
    assert.equal(formatSettlementAmount('0.00', locale, true, false), '0')
    assert.equal(formatSettlementAmount('-0.00', locale, true, false), '0')
    assert.equal(formatSettlementAmount('1234.50', locale), `${debit.slice(1)} ₫`)
    assert.equal(formatSettlementAmount('1234.50', locale, false, true), `${debit.slice(1)} ₫`)
  }
})

test('numeric-only amounts keep absent or invalid evidence unavailable in both languages', () => {
  for (const locale of ['vi', 'en']) {
    for (const value of [null, undefined, '', 'NaN', 'Infinity', '1e3', '1.234', '1,000']) {
      assert.equal(formatSettlementAmount(value, locale, false, false), '—')
    }
  }
})

test('unknown monetary evidence stays unavailable instead of becoming zero', () => {
  for (const value of [null, undefined, '', 'NaN', 'Infinity', '1e3', '1.234', '1,000']) {
    assert.equal(formatSettlementAmount(value), '—')
    assert.equal(settlementAmountTone(value), '')
  }
  assert.equal(settlementAmountTone('-0.00'), '')
  assert.equal(settlementAmountTone('-0.01'), 'negative')
  assert.equal(settlementAmountTone('1000000000000000000'), 'positive')
})

test('weekly end is exclusive and displayed as the last local day of the period', () => {
  assert.equal(
    formatSettlementPeriod({ start: '2026-09-27T17:00:00Z', end: '2026-10-04T17:00:00Z' }),
    '28/09/2026 – 04/10/2026'
  )
  assert.equal(
    formatSettlementPeriod({
      start: '2024-02-26T00:00:00+07:00',
      end: '2024-03-04T00:00:00+07:00',
    }),
    '26/02/2024 – 03/03/2024'
  )
  assert.equal(formatSettlementPeriod(null), '—')
  assert.equal(formatSettlementPeriod({ start: '2026-10-01', end: 'invalid' }), '—')
})

test('timestamps always use Vietnam time and unavailable dates are explicit', () => {
  assert.equal(formatSettlementDate('2026-09-30T17:00:00Z'), '01/10/2026')
  assert.equal(formatSettlementTime('2026-09-30T17:02:00Z'), '01/10/2026, 00:02')
  assert.equal(formatSettlementDate(null), '—')
  assert.equal(formatSettlementTime('invalid'), '—')
})

test('verified payment, top-up and withdrawal sources use existing detail routes', () => {
  assert.equal(settlementSourceUrl({ type: 'PAYMENT', id }), `/admin/payments/${id}`)
  assert.equal(settlementSourceUrl({ type: 'TOP_UP', id }), `/admin/topups/${id}`)
  assert.equal(settlementSourceUrl({ type: 'WITHDRAWAL', id }), `/admin/withdrawals/${id}`)
  assert.equal(settlementSourceUrl({ type: 'ADJUSTMENT', id }), null)
  assert.equal(settlementSourceUrl({ type: 'PAYMENT', id: '../../profile' }), null)
  assert.equal(settlementSourceUrl(null), null)
})

test('server error text is not reflected into admin UI and authorization errors are distinct', () => {
  const error = { status: 500, message: 'private SQL and credentials' }
  assert.equal(settlementErrorMessage(error), 'Unable to load settlements. Please try again.')
  assert.equal(
    settlementErrorMessage(error, true),
    'Unable to load settlement details. Please try again.'
  )
  assert.equal(
    settlementErrorMessage({ status: 403 }),
    'You do not have permission to view settlements.'
  )
  assert.equal(settlementErrorMessage({ status: 404 }), 'This settlement could not be found.')
  assert.equal(settlementErrorMessage({ status: 422 }, true), 'The settlement request is invalid.')
  assert.equal(settlementErrorMessage({}), 'Unable to connect to the server. Please try again.')
})

test('technician avatar fallback handles Vietnamese names and absent names', () => {
  assert.equal(technicianInitials('  Trần Minh Khang '), 'MK')
  assert.equal(technicianInitials('Thanh'), 'T')
  assert.equal(technicianInitials(null), '?')
})
