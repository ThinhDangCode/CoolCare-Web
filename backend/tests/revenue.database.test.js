import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import {
  RevenueRepository,
  buildRevenueAggregationSql,
} from '../src/modules/revenue/revenue.repository.js'
import { RevenueService, presentRevenueReport } from '../src/modules/revenue/revenue.service.js'
import { validateRevenueQuery } from '../src/modules/revenue/revenue.validation.js'
import { revenueUnits, revenueDecimal } from '../src/modules/revenue/revenue.money.js'

const enabled = process.env.RUN_REVENUE_DB_TESTS === '1'
const sourceService = '10000000-0000-0000-0000-000000000001'
const sourceServiceB = '10000000-0000-0000-0000-000000000002'
const sourceServiceC = '10000000-0000-0000-0000-000000000003'
const syntheticSql = buildRevenueAggregationSql({
  payments: `SELECT * FROM (VALUES
    ('round','round-book','SUCCESS','2026-10-01 00:00:00+07'::timestamptz,0.02::numeric,3.00::numeric,' CẦN   THƠ '),
    ('valid','valid-book','SUCCESS','2026-10-03 00:00:00+07'::timestamptz,20.00::numeric,100.00::numeric,'Cần Thơ'),
    ('mismatch','mismatch-book','SUCCESS','2026-10-03 01:00:00+07'::timestamptz,5.00::numeric,100.00::numeric,'can tho'),
    ('missing','missing-book','SUCCESS','2026-10-03 02:00:00+07'::timestamptz,NULL::numeric,100.00::numeric,'Cần Thơ'),
    ('huge1','huge-book','SUCCESS','2026-10-03 03:00:00+07'::timestamptz,999999999999.99::numeric,999999999999.99::numeric,'Cần Thơ'),
    ('huge2','huge-book','SUCCESS','2026-10-31 23:59:59+07'::timestamptz,999999999999.99::numeric,999999999999.99::numeric,'Cần Thơ'),
    ('prior','prior-book','SUCCESS','2026-09-30 23:59:59+07'::timestamptz,500.00::numeric,2500.00::numeric,'Cần Thơ'),
    ('unpaid','round-book','PROCESSING','2026-10-03 03:00:00+07'::timestamptz,10.00::numeric,3.00::numeric,'Cần Thơ'),
    ('next','round-book','SUCCESS','2026-11-01 00:00:00+07'::timestamptz,10.00::numeric,3.00::numeric,'Cần Thơ'),
    ('old','round-book','SUCCESS','2026-08-31 23:59:59+07'::timestamptz,10.00::numeric,3.00::numeric,'Cần Thơ'),
    ('no-settle','round-book','SUCCESS',NULL::timestamptz,10.00::numeric,3.00::numeric,'Cần Thơ')
  ) AS p(id,booking_id,payment_status,settled_at,commission_amount,commission_base_amount,city)`,
  lines: `SELECT * FROM (VALUES
    ('round-book','ra',1.00::numeric,'SERVICE','${sourceService}','A'),
    ('round-book','rb',1.00::numeric,'SERVICE','${sourceServiceB}','B'),
    ('round-book','rc',1.00::numeric,'SERVICE','${sourceServiceC}','C'),
    ('valid-book','va',60.00::numeric,'SERVICE','${sourceService}','A'),
    ('valid-book','vl',40.00::numeric,'LABOR',NULL::text,NULL::text),
    ('mismatch-book','ma',40.00::numeric,'SERVICE','${sourceService}','A'),
    ('missing-book','mi',100.00::numeric,'SERVICE','${sourceService}','A'),
    ('huge-book','hi',999999999999.99::numeric,'SERVICE','${sourceService}','A'),
    ('prior-book','pa',2500.00::numeric,'SERVICE','${sourceService}','A')
  ) AS l(booking_id,item_id,total_price,item_type,service_id,service_name)`,
})

test(
  'real revenue report matches successful settled commission, not gross receipts, and leaves local tables unchanged',
  { skip: !enabled },
  async () => {
    const tables = [
      'payments',
      'bookings',
      'quotation_items',
      'quotations',
      'technician_accounts',
      'technician_topups',
      'withdrawals',
      'settlement_transactions',
      'settlements',
      'invoices',
    ]
    const checksum = async () =>
      Promise.all(
        tables.map(
          async (table) =>
            (
              await pool.query(
                `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) AS checksum FROM ${table} t`
              )
            ).rows[0].checksum
        )
      )
    const before = await checksum()
    const request = { period: 'YEAR', year: '2026' }
    const report = await new RevenueService(new RevenueRepository(), {
      audit: () => {},
    }).getRevenueReport(request, 'readonly-test')
    const expected = (
      await pool.query(`SELECT count(*)::text AS count,SUM(commission_amount)::text AS commission,
      count(*) FILTER(WHERE commission_amount IS NULL)::text AS missing
      FROM payments WHERE payment_status='SUCCESS' AND settled_at IS NOT NULL
      AND settled_at >= ('2026-01-01'::date::timestamp AT TIME ZONE INTERVAL '+07:00')
      AND settled_at < ('2027-01-01'::date::timestamp AT TIME ZONE INTERVAL '+07:00')`)
    ).rows[0]
    assert.equal(report.summary.paymentCount, Number(expected.count))
    assert.equal(report.summary.missingCommissionCount, Number(expected.missing))
    if (Number(expected.missing) === 0) {
      assert.equal(
        report.summary.totalRevenue,
        revenueDecimal(revenueUnits(expected.commission ?? '0'))
      )
      assert.equal(
        report.services.reduce((sum, item) => sum + revenueUnits(item.knownAmount), 0n),
        revenueUnits(report.summary.knownRevenue)
      )
      assert.equal(
        report.areas.reduce((sum, item) => sum + revenueUnits(item.knownAmount), 0n),
        revenueUnits(report.summary.knownRevenue)
      )
      assert.equal(
        report.trend.reduce((sum, item) => sum + revenueUnits(item.knownAmount), 0n),
        revenueUnits(report.summary.knownRevenue)
      )
    }
    assert.equal(report.trend.length, 12)
    assert.deepEqual(await checksum(), before)
  }
)

test(
  'real allocation SQL uses exact remainder cents, literal booking-city groups, missing/invalid allocations and period boundaries',
  { skip: !enabled },
  async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN READ ONLY')
      const read = async (service = 'ALL', area = 'ALL') =>
        (
          await client.query(syntheticSql, [
            '2026-10-01',
            '2026-10-31',
            '2026-09-01',
            '2026-09-30',
            service,
            area,
            'MONTH',
            service === sourceServiceB ? 'B' : 'A',
          ])
        ).rows
      const all = await read()
      const summary = all.find((row) => row.kind === 'SUMMARY' && row.period === 'CURRENT')
      assert.equal(summary.paymentCount, '6')
      assert.equal(summary.amount, null)
      assert.equal(revenueDecimal(revenueUnits(summary.knownAmount)), '2000000000025.00')
      assert.equal(summary.missingCommissionCount, '1')
      assert.equal(summary.unallocatedCount, '1')
      assert.equal(summary.unclassifiedCount, '1')
      const services = all.filter((row) => row.kind === 'SERVICE')
      assert.equal(services.find((row) => row.key === sourceServiceB).amount, '0.01')
      assert.equal(services.find((row) => row.key === sourceServiceC).amount, '0.00')
      assert.equal(services.find((row) => row.key === 'UNCLASSIFIED').amount, '8.00')
      assert.equal(services.find((row) => row.key === 'UNALLOCATED').amount, '5.00')
      assert.equal(all.filter((row) => row.kind === 'AREA').length, 1)
      assert.equal(all.find((row) => row.kind === 'AREA').key, 'Cần Thơ')
      assert.equal(
        all.find((row) => row.kind === 'SUMMARY' && row.period === 'PREVIOUS').amount,
        '500.00'
      )
      const selectedA = (await read(sourceService)).find(
        (row) => row.kind === 'SUMMARY' && row.period === 'CURRENT'
      )
      assert.equal(selectedA.amount, null)
      assert.equal(revenueDecimal(revenueUnits(selectedA.knownAmount)), '2000000000011.99')
      assert.equal(selectedA.unknownCount, '2')
      const selectedB = (await read(sourceServiceB)).find(
        (row) => row.kind === 'SUMMARY' && row.period === 'CURRENT'
      )
      assert.equal(selectedB.amount, null)
      assert.equal(selectedB.knownAmount, '0.01')
      assert.equal(selectedB.paymentCount, '2')
      const invalid = (await read('UNALLOCATED')).find(
        (row) => row.kind === 'SUMMARY' && row.period === 'CURRENT'
      )
      assert.equal(invalid.amount, '5.00')
      assert.equal(invalid.unknownCount, '0')
      assert.equal((await read('ALL', 'Hà Nội')).length, 0)
      const presented = presentRevenueReport(
        validateRevenueQuery({ period: 'MONTH', year: '2026', month: '10' }),
        { rows: all, options: { services: [], areas: [] } }
      )
      assert.equal(presented.summary.totalRevenue, null)
      assert.equal(presented.summary.knownRevenue, '2000000000025.00')
      assert.equal(presented.trend[30].previousAmount, null)
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  }
)

test(
  'full-period aggregation is not capped at ten thousand payments',
  { skip: !enabled },
  async () => {
    const sql = buildRevenueAggregationSql({
      payments: `SELECT i::text AS id,'many'::text AS booking_id,'SUCCESS'::text AS payment_status,
        '2026-10-01 00:00:00+07'::timestamptz AS settled_at,1.00::numeric AS commission_amount,
        1.00::numeric AS commission_base_amount,'Cần Thơ'::text AS city FROM generate_series(1,10001) i`,
      lines: `SELECT 'many'::text AS booking_id,'line'::text AS item_id,1.00::numeric AS total_price,
        'SERVICE'::text AS item_type,'${sourceService}'::text AS service_id,'A'::text AS service_name`,
    })
    const rows = (
      await pool.query(sql, [
        '2026-10-01',
        '2026-10-31',
        '2026-09-01',
        '2026-09-30',
        'ALL',
        'ALL',
        'MONTH',
        'All',
      ])
    ).rows
    const summary = rows.find((row) => row.kind === 'SUMMARY' && row.period === 'CURRENT')
    assert.equal(summary.paymentCount, '10001')
    assert.equal(summary.amount, '10001.00')
  }
)

test.after(async () => {
  await pool.end()
})
