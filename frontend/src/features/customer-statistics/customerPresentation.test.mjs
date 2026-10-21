import test from 'node:test'
import assert from 'node:assert/strict'
import {
  customerApiQuery,
  customerAreaRows,
  customerChartScale,
  customerDecimal,
  customerErrorKey,
  customerFiltersQuery,
  customerInitials,
  customerShare,
  readCustomerFilters,
} from './customerPresentation.js'

const defaults = { from: '2026-09-16', to: '2026-10-15' }
const read = (query) => readCustomerFilters(new URLSearchParams(query), defaults)

test('default customer filters use the approved overview, range and table page size', () => {
  assert.deepEqual(read(''), {
    tab: 'overview',
    range: defaults,
    search: '',
    page: 1,
    limit: 10,
    error: '',
  })
})

test('all six customer sections round-trip dates, unicode search and table parameters through the URL', () => {
  for (const tab of ['overview', 'new', 'areas', 'services', 'cancellations', 'locked']) {
    const filters = {
      tab,
      range: { from: '2024-02-01', to: '2024-02-29' },
      search: 'Đỗ An & +84',
      page: 2,
      limit: 50,
      error: '',
    }
    assert.deepEqual(read(customerFiltersQuery(filters)), filters)
  }
})

test('only the locked table sends contact search and pagination to the API', () => {
  const filters = read('tab=locked&search=An&page=3&limit=20')
  assert.equal(customerApiQuery(filters), 'from=2026-09-16&to=2026-10-15&search=An&page=3&limit=20')
  assert.equal(customerApiQuery({ ...filters, tab: 'new' }), 'from=2026-09-16&to=2026-10-15')
})

test('unknown and repeated URL fields are invalid, including duplicated equal values', () => {
  for (const query of [
    'tab=new&tab=new',
    'search=An&search=An',
    'page=1&page=1',
    'sort=name',
    'from=2026-10-01&from=2026-10-01',
  ])
    assert.equal(
      read(query).error,
      'The customer statistics link contains unsupported or repeated filters.'
    )
})

test('invalid tabs, strict integer pages and unsupported page sizes are rejected before requests', () => {
  assert.equal(read('tab=technicians').error, 'Choose a valid customer statistics tab.')
  for (const page of ['0', '-1', '1.2', 'abc', '01', '1000001'])
    assert.notEqual(read(`page=${page}`).error, '')
  for (const limit of ['0', '15', '010', '10.0', '100', '1e1'])
    assert.equal(read(`limit=${limit}`).error, 'Choose 10, 20, or 50 rows per page.')
})

test('date validation rejects incomplete, impossible, reversed and overlong periods', () => {
  for (const query of [
    'from=2026-01-01',
    'from=2026-02-29&to=2026-03-01',
    'from=2026-10-16&to=2026-10-15',
    'from=2024-01-01&to=2025-01-01',
  ])
    assert.notEqual(read(query).error, '')
  assert.equal(read('from=2024-01-01&to=2024-12-31').error, '')
})

test('contact searches are trimmed, bounded and reject hidden control characters', () => {
  assert.equal(read('search=%20Nguy%E1%BB%85n%20An%20').search, 'Nguyễn An')
  for (const search of ['a'.repeat(151), 'a\nb', '\tAn', 'a\u007fb'])
    assert.equal(
      read(new URLSearchParams({ search }).toString()).error,
      'Use a search term of 150 characters or fewer, without control characters.'
    )
})

test('top eight area chart preserves all customer counts and denominator using Other areas', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    key: `area-${index}`,
    label: `Area ${index}`,
    count: 12 - index,
  }))
  const totalCustomers = items.reduce((sum, item) => sum + item.count, 0)
  const chart = customerAreaRows({ items, totalCustomers })
  assert.equal(chart.length, 9)
  assert.deepEqual(chart.slice(0, 8), items.slice(0, 8))
  assert.equal(chart.at(-1).other, true)
  assert.equal(chart.at(-1).count, 10)
  assert.equal(chart.at(-1).percentage, (10 * 100) / totalCustomers)
  assert.equal(
    chart.reduce((sum, item) => sum + item.count, 0),
    totalCustomers
  )
  assert.equal(customerAreaRows({ items: [], totalCustomers: 0 }).length, 0)
})

test('count chart axes remain integer-valued and cover all series, including zero data', () => {
  for (const rows of [[], [{ a: 0, b: 0 }], [{ a: 1, b: 9 }], [{ a: 33, b: 75 }]]) {
    const maximum = customerChartScale(rows, ['a', 'b'])
    assert.ok(maximum >= 4)
    assert.equal(maximum % 4, 0)
    assert.ok(rows.every((row) => maximum >= row.a && maximum >= row.b))
  }
  assert.equal(customerChartScale([{ count: 10 }], ['count']), 12)
  assert.equal(customerChartScale([{ count: 1 }], ['count']), 4)
})

test('customer averages and shares localize safely, with explicit unavailable and empty cases', () => {
  assert.equal(customerDecimal(12.345, 'vi'), '12,35')
  assert.equal(customerDecimal(12.345, 'en'), '12.35')
  assert.equal(customerDecimal(null), '—')
  assert.equal(customerDecimal(Infinity), '—')
  assert.equal(customerShare(0, 0), 0)
  assert.equal(customerShare(4, 10), 40)
  assert.equal(customerInitials('Nguyễn Văn An'), 'VA')
})

test('customer API failures map to translation keys without exposing backend or contact details', () => {
  assert.equal(
    customerErrorKey({ status: 403 }),
    'You do not have permission to view customer statistics.'
  )
  assert.equal(
    customerErrorKey({ status: 422 }),
    'Check the customer statistics filters and try again.'
  )
  assert.equal(
    customerErrorKey({ message: 'Không thể kết nối máy chủ. Vui lòng thử lại.' }),
    'Unable to connect to the server. Please try again.'
  )
  assert.equal(
    customerErrorKey({ message: 'Database query failed; customer@example.com' }),
    'Unable to load customer statistics. Please try again.'
  )
})
