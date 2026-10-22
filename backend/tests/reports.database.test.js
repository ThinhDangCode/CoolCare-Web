import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { ReportsRepository, buildReportsAggregationSql } from '../src/modules/reports/reports.repository.js'
import { ReportsService, presentReports } from '../src/modules/reports/reports.service.js'
import { validateReportsQuery } from '../src/modules/reports/reports.validation.js'
import { revenueUnits, revenueDecimal } from '../src/modules/revenue/revenue.money.js'

const enabled = process.env.RUN_REPORTS_DB_TESTS === '1'
const fixtureSources = {
  bookings: `SELECT * FROM (VALUES
    ('complete','2026-09-30 17:00:00+00'::timestamptz,9),
    ('p1','2026-10-15 01:00:00+07'::timestamptz,0),
    ('p2','2026-10-15 01:00:00+07'::timestamptz,1),
    ('p3','2026-10-15 01:00:00+07'::timestamptz,2),
    ('p4','2026-10-15 01:00:00+07'::timestamptz,3),
    ('p5','2026-10-15 01:00:00+07'::timestamptz,4),
    ('p6','2026-10-15 01:00:00+07'::timestamptz,5),
    ('p7','2026-10-15 01:00:00+07'::timestamptz,6),
    ('p8','2026-10-15 01:00:00+07'::timestamptz,7),
    ('p9','2026-10-15 01:00:00+07'::timestamptz,8),
    ('cancel','2026-10-31 16:59:59.999+00'::timestamptz,10),
    ('prior','2026-09-30 16:59:59.999+00'::timestamptz,9),
    ('next','2026-10-31 17:00:00+00'::timestamptz,9)
  ) b(id,created_at,status)`,
  payments: `SELECT * FROM (VALUES
    (2,'2026-09-30 17:00:00+00'::timestamptz,10.01::numeric),
    (2,'2026-10-15 01:00:00+07'::timestamptz,NULL::numeric),
    (2,'2026-10-31 16:59:59.999+00'::timestamptz,999999999999999999.99::numeric),
    (2,'2026-09-30 16:59:59.999+00'::timestamptz,100.00::numeric),
    (2,'2026-10-31 17:00:00+00'::timestamptz,200.00::numeric),
    (3,'2026-10-15 01:00:00+07'::timestamptz,300.00::numeric),
    (0,'2026-10-15 01:00:00+07'::timestamptz,400.00::numeric),
    (2,NULL::timestamptz,500.00::numeric)
  ) p(payment_status,settled_at,commission_amount)`,
  customers: 'SELECT i AS id FROM generate_series(1,10) i',
  technicians: 'SELECT i AS id FROM generate_series(1,4) i',
  units: `SELECT * FROM (VALUES ('u1','complete'),('u2','complete'),('u3','p1'),('u4','prior'),('u5','next')) u(id,booking_id)`,
  unitServices: `SELECT * FROM (VALUES ('u1','a'),('u1','b'),('u2','a'),('u3','a'),('u4','a'),('u5','a')) us(booking_unit_id,service_id)`,
  // Includes a used inactive service: aggregation must not filter by current catalog activity.
  services: `SELECT * FROM (VALUES ('a','Cleaning',false),('b','Repair',true),('c','Unused',true)) s(id,name,is_active)`,
}

async function fixtureReport(query, overrides = {}) {
  const period = validateReportsQuery(query)
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const { rows } = await client.query(buildReportsAggregationSql({ ...fixtureSources, ...overrides }),
      [period.from, period.to, period.granularity])
    await client.query('ROLLBACK')
    return presentReports(period, { ...rows[0], asOf: rows[0].asOf.toISOString() })
  } finally {
    client.release()
  }
}

test('SELECT-only fixtures cover all statuses, UTC+7 boundaries, independent payment cohorts and multi-unit service counts',
  { skip: !enabled }, async () => {
    const report = await fixtureReport({ from: '2026-10-01', to: '2026-10-31' })
    assert.equal(report.summary.bookings, 11)
    assert.equal(report.summary.customers, 10)
    assert.equal(report.summary.technicians, 4)
    assert.deepEqual(report.bookingOverview.map((item) => item.count), [1, 9, 1])
    assert.equal(report.bookingOverview.reduce((sum, item) => sum + item.count, 0), 11)
    assert.equal(report.summary.settledPayments, 3)
    assert.equal(report.summary.missingCommissionPayments, 1)
    assert.equal(report.summary.commissionAmount, null)
    assert.equal(report.summary.averageCommissionAmount, null)
    assert.equal(report.summary.knownCommissionAmount, '1000000000000000010.00')
    assert.equal(report.trend.length, 31)
    assert.equal(report.trend[0].bookings, 1)
    assert.equal(report.trend[0].commissionAmount, '10.01')
    assert.equal(report.trend[1].commissionAmount, '0.00')
    assert.equal(report.trend[14].bookings, 9)
    assert.equal(report.trend[14].commissionAmount, null)
    assert.equal(report.trend[30].bookings, 1)
    assert.equal(report.trend[30].commissionAmount, '999999999999999999.99')
    assert.equal(report.trend.reduce((sum, point) => sum + point.bookings, 0), report.summary.bookings)
    assert.equal(revenueDecimal(report.trend.reduce((sum, point) => sum + revenueUnits(point.knownCommissionAmount), 0n)),
      report.summary.knownCommissionAmount)
    assert.deepEqual(report.services, { totalUses: 4, items: [
      { id: 'a', name: 'Cleaning', count: 3, percentage: 75 },
      { id: 'b', name: 'Repair', count: 1, percentage: 25 },
    ] })
  })

test('monthly trends clip edge months to selected dates; empty periods keep current profiles and zero-filled buckets',
  { skip: !enabled }, async () => {
    const report = await fixtureReport({ from: '2026-07-15', to: '2026-10-15' })
    assert.equal(report.period.granularity, 'month')
    assert.deepEqual(report.trend.map((point) => point.date), ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'])
    assert.equal(report.summary.bookings, 11) // Prior boundary booking belongs to this wider cohort, October 31 does not.
    assert.equal(report.summary.settledPayments, 3)
    assert.equal(report.summary.knownCommissionAmount, '110.01')
    assert.equal(report.trend[3].knownCommissionAmount, '10.01')
    const empty = await fixtureReport({ from: '2025-12-31', to: '2026-01-02' })
    assert.equal(empty.summary.bookings, 0)
    assert.equal(empty.summary.customers, 10)
    assert.equal(empty.summary.technicians, 4)
    assert.equal(empty.summary.commissionAmount, '0.00')
    assert.equal(empty.summary.settledPayments, 0)
    assert.equal(empty.summary.averageCommissionAmount, null)
    assert.deepEqual(empty.bookingOverview.map((item) => [item.count, item.percentage]), [[0, 0], [0, 0], [0, 0]])
    assert.deepEqual(empty.services, { totalUses: 0, items: [] })
    assert.equal(empty.trend.length, 3)
    assert.ok(empty.trend.every((point) => point.bookings === 0 && point.commissionAmount === '0.00'))
  })

test('fixed UTC+7 historical boundaries and year 9999 do not shift or overflow buckets', { skip: !enabled }, async () => {
  for (const date of ['1900-01-01', '9999-12-31']) {
    const report = await fixtureReport({ from: date, to: date }, {
      bookings: `SELECT 'historic'::text AS id,'${date} 00:00:00+07'::timestamptz AS created_at,9::smallint AS status`,
      payments: `SELECT 2::smallint AS payment_status,'${date} 00:00:00+07'::timestamptz AS settled_at,0.00::numeric AS commission_amount`,
    })
    assert.equal(report.summary.bookings, 1)
    assert.equal(report.summary.settledPayments, 1)
    assert.equal(report.summary.commissionAmount, '0.00')
    assert.equal(report.summary.averageCommissionAmount, '0.00')
    assert.equal(report.trend[0].date, date)
    assert.equal(report.trend[0].bookings, 1)
  }
})

test('local report reconciles independently with saved settlements, booking statuses and every service use without changing tables',
  { skip: !enabled }, async () => {
    const tables = ['payments', 'bookings', 'booking_units', 'booking_unit_services', 'services',
      'customer_profiles', 'technician_profiles', 'technician_accounts', 'technician_topups', 'withdrawals']
    const checksum = async () => Promise.all(tables.map(async (table) => (
      await pool.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) AS checksum FROM ${table} t`)
    ).rows[0].checksum))
    const before = await checksum()
    const report = await new ReportsService(new ReportsRepository(), { audit: () => {} })
      .getReports({ from: '2026-01-01', to: '2026-12-31' }, 'readonly-test')
    const expected = (await pool.query(`WITH cohort AS (
      SELECT id,status FROM bookings WHERE created_at >= '2026-01-01 00:00:00+07'::timestamptz
        AND created_at < '2027-01-01 00:00:00+07'::timestamptz
    ) SELECT (SELECT count(*) FROM cohort)::text AS bookings,
      (SELECT count(*) FROM customer_profiles)::text AS customers,
      (SELECT count(*) FROM technician_profiles)::text AS technicians,
      (SELECT count(*) FROM cohort b JOIN booking_units u ON u.booking_id=b.id
        JOIN booking_unit_services s ON s.booking_unit_id=u.id)::text AS uses,
      count(*)::text AS payments,count(*) FILTER(WHERE commission_amount IS NULL)::text AS missing,
      COALESCE(sum(commission_amount),0)::text AS known
      FROM payments WHERE payment_status='SUCCESS' AND settled_at >= '2026-01-01 00:00:00+07'::timestamptz
        AND settled_at < '2027-01-01 00:00:00+07'::timestamptz`)).rows[0]
    assert.equal(report.summary.bookings, Number(expected.bookings))
    assert.equal(report.summary.customers, Number(expected.customers))
    assert.equal(report.summary.technicians, Number(expected.technicians))
    assert.equal(report.services.totalUses, Number(expected.uses))
    assert.equal(report.summary.settledPayments, Number(expected.payments))
    assert.equal(report.summary.missingCommissionPayments, Number(expected.missing))
    assert.equal(report.summary.knownCommissionAmount, revenueDecimal(revenueUnits(expected.known)))
    assert.equal(report.summary.commissionAmount, expected.missing === '0' ? report.summary.knownCommissionAmount : null)
    assert.equal(report.bookingOverview.reduce((sum, item) => sum + item.count, 0), report.summary.bookings)
    assert.equal(report.trend.reduce((sum, point) => sum + point.bookings, 0), report.summary.bookings)
    assert.equal(report.services.items.reduce((sum, item) => sum + item.count, 0), report.services.totalUses)
    assert.equal(report.trend.length, 12)
    assert.deepEqual(await checksum(), before)
  })

test.after(async () => { await pool.end() })
