import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readTechnicianFilters,
  technicianApiQuery,
  technicianDecimal,
  technicianErrorKey,
  technicianFiltersQuery,
  technicianLineSegments,
  technicianMoneyScale,
  technicianRate,
  technicianScale,
} from './technicianPresentation.js'
import { reportMoneyUnits } from '../reports/reportPresentation.js'

const defaults = { from: '2026-09-22', to: '2026-10-21' }
const read = (query) => readTechnicianFilters(new URLSearchParams(query), defaults)

test('locked contact filters survive URL round trips without filtering global technician aggregates', () => {
  const filters = read('tab=locked&search=Nguy%E1%BB%85n+An+%25_&page=2&limit=50')
  assert.equal(filters.error, '')
  assert.deepEqual(read(technicianFiltersQuery(filters)), filters)
  assert.equal(
    technicianApiQuery(filters),
    'from=2026-09-22&to=2026-10-21&search=Nguy%E1%BB%85n+An+%25_&page=2&limit=50'
  )
  for (const tab of ['overview', 'income', 'areas', 'services', 'issues'])
    assert.equal(technicianApiQuery({ ...filters, tab }), 'from=2026-09-22&to=2026-10-21')
})

test('ambiguous repeated filters and unknown fields or tabs cannot silently change report scope', () => {
  for (const query of [
    'tab=income&tab=income',
    'search=An&search=An',
    'sort=name',
    'page=2&page=3',
    'from=2026-01-01&from=2026-01-01',
  ])
    assert.match(read(query).error, /unsupported or repeated/)
  assert.match(read('tab=revenue').error, /valid technician/)
})

test('strict dates retain leap-day boundaries and reject incomplete or excessive ranges', () => {
  assert.equal(read('from=2024-01-01&to=2024-12-31').error, '')
  for (const query of [
    'from=2026-01-01',
    'from=2026-02-29&to=2026-03-01',
    'from=2026-10-22&to=2026-10-21',
    'from=2024-01-01&to=2025-01-01',
  ])
    assert.notEqual(read(query).error, '')
})

test('table bounds and hidden search characters are rejected before sending a request', () => {
  for (const page of ['0', '01', '1e2', '1.5', '1000001'])
    assert.notEqual(read(`page=${page}`).error, '')
  for (const limit of ['010', '10.0', '100', '1e1'])
    assert.notEqual(read(`limit=${limit}`).error, '')
  for (const search of ['x'.repeat(151), 'An\nNam', '\tAn', 'An\u007f'])
    assert.notEqual(read(new URLSearchParams({ search }).toString()).error, '')
})

test('money charts cover known partial values and remain precise above Number safe-integer limits', () => {
  const huge = '99999999999999999999999999999.99'
  const rows = [
    { amount: null, knownAmount: huge },
    { amount: '0.01', knownAmount: '0.01' },
  ]
  const scale = technicianMoneyScale(rows)
  const exact = reportMoneyUnits(huge)
  assert.ok(scale.maximum >= exact)
  assert.equal(scale.maximum % 4n, 0n)
  assert.equal(scale.ratio(null), null)
  assert.ok(scale.ratio(exact) > 0 && scale.ratio(exact) <= 1)
  assert.equal(scale.ratio(reportMoneyUnits('0.00')), 0)
  assert.ok(technicianMoneyScale([]).maximum > 0n)
})

test('chart paths never connect unavailable earnings or empty rating buckets', () => {
  const first = { x: 0, y: 2 },
    second = { x: 1, y: 4 },
    third = { x: 3, y: 0 }
  assert.deepEqual(technicianLineSegments([null, first, second, null, third, null]), [
    [first, second],
    [third],
  ])
  assert.deepEqual(technicianLineSegments([null, null]), [])
})

test('empty cohorts have unavailable completion rates and ratings, not artificial zero satisfaction', () => {
  assert.equal(technicianRate(0, 0), null)
  assert.equal(technicianRate(0, 3), 0)
  assert.equal(technicianRate(8, 12), (8 * 100) / 12)
  assert.equal(technicianDecimal(null), '—')
  assert.equal(technicianDecimal(Infinity), '—')
  assert.equal(technicianDecimal(4.825, 'vi'), '4,83')
  assert.equal(technicianDecimal(4.825, 'en'), '4.83')
})

test('count axes cover every series and remain integer-valued for small or empty datasets', () => {
  for (const rows of [
    [],
    [{ complaints: 0, penalties: 0 }],
    [{ complaints: 1, penalties: 10 }],
    [{ complaints: 10001, penalties: 5 }],
  ]) {
    const maximum = technicianScale(rows, ['complaints', 'penalties'])
    assert.equal(maximum % 4, 0)
    assert.ok(maximum >= 4)
    assert.ok(rows.every((row) => maximum >= row.complaints && maximum >= row.penalties))
  }
  assert.equal(technicianScale([{ count: 10 }], ['count']), 12)
})

test('API errors expose localized recovery keys instead of SQL, identifiers or contact data', () => {
  assert.match(technicianErrorKey({ status: 403 }), /permission/)
  assert.match(technicianErrorKey({ status: 422 }), /filters/)
  assert.equal(
    technicianErrorKey({ message: 'Không thể kết nối máy chủ. Vui lòng thử lại.' }),
    'Unable to connect to the server. Please try again.'
  )
  assert.equal(
    technicianErrorKey({ message: 'SELECT private@example.com' }),
    'Unable to load technician statistics. Please try again.'
  )
})
