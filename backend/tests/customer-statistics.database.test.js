import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { buildCustomerStatisticsSql, CustomerStatisticsRepository } from '../src/modules/customer-statistics/customer-statistics.repository.js'
import { CustomerStatisticsService, presentCustomerStatistics } from '../src/modules/customer-statistics/customer-statistics.service.js'
import { validateCustomerStatisticsQuery } from '../src/modules/customer-statistics/customer-statistics.validation.js'

const enabled = process.env.RUN_CUSTOMER_STATISTICS_DB_TESTS === '1'
const fixtureSources = {
  customers: `SELECT * FROM (VALUES
    ('c1','u1','2026-09-30 17:00:00+00'::timestamptz),
    ('c2','u2','2026-09-01 00:00:00+07'::timestamptz),
    ('c3','u3','2026-10-31 16:59:59.999+00'::timestamptz),
    ('c4','u4','2026-10-31 17:00:00+00'::timestamptz),
    ('c5','u5','2026-09-30 16:59:59.999+00'::timestamptz),
    ('c6','u6','2026-01-01 00:00:00+07'::timestamptz)
  ) c(id,user_id,created_at)`,
  users: `SELECT * FROM (VALUES
    ('u1','Dual customer and technician','one@example.com',NULL::text,NULL::text,0),
    ('u2','Second','two@example.com','0901234567',NULL,0),
    ('u3','Literal %_ customer','three@example.com',NULL,NULL,1),
    ('u4','Inactive','four@example.com',NULL,NULL,2),
    ('u5','Locked normal','five@example.com',NULL,NULL,1),
    ('u6','No bookings','six@example.com',NULL,NULL,0)
  ) u(id,full_name,email,phone,avatar_url,status)`,
  addresses: `SELECT * FROM (VALUES
    ('a1','c1','Alpha','Common','Same',true),('a2','c1','Ignore','Other','Other',false),
    ('a3','c2','Beta','Common','Same',true),('a4','c5','Alpha','Common','Same',true),
    ('a5','c3','Missing default','Other',NULL,false)
  ) a(id,customer_id,city,district,ward,is_default)`,
  bookings: `SELECT * FROM (VALUES
    ('b1','c1','2026-09-30 17:00:00+00'::timestamptz,9,NULL::text),
    ('b2','c1','2026-10-15 00:00:00+07'::timestamptz,9,NULL),
    ('b3','c2','2026-10-15 00:00:00+07'::timestamptz,9,NULL),
    ('b4','c1','2026-10-15 00:00:00+07'::timestamptz,10,'u1'),
    ('b5','c2','2026-10-15 00:00:00+07'::timestamptz,10,'admin'),
    ('b6','c3','2026-10-15 00:00:00+07'::timestamptz,10,'technician'),
    ('b7','c4','2026-10-15 00:00:00+07'::timestamptz,10,NULL),
    ('b8','c5','2026-10-15 00:00:00+07'::timestamptz,7,NULL),
    ('b9','c5','2026-10-15 00:00:00+07'::timestamptz,3,NULL),
    ('b10','c1','2026-10-15 00:00:00+07'::timestamptz,2,NULL),
    ('outside1','c1','2026-10-31 17:00:00+00'::timestamptz,9,NULL),
    ('outside2','c2','2026-09-30 16:59:59.999+00'::timestamptz,9,NULL),
    ('p1','c1','2026-10-15 00:00:00+07'::timestamptz,0,NULL),
    ('p2','c1','2026-10-15 00:00:00+07'::timestamptz,1,NULL),
    ('p3','c1','2026-10-15 00:00:00+07'::timestamptz,4,NULL),
    ('p4','c1','2026-10-15 00:00:00+07'::timestamptz,5,NULL),
    ('p5','c1','2026-10-15 00:00:00+07'::timestamptz,6,NULL),
    ('p6','c1','2026-10-15 00:00:00+07'::timestamptz,8,NULL)
  ) b(id,customer_id,created_at,status,cancelled_by_id)`,
  quotations: `SELECT * FROM (VALUES ('b4',3),('b4',3),('b9',3),
    ('b10',2),('p1',1)) q(booking_id,status)`,
  units: `SELECT * FROM (VALUES ('unit1','b1'),('unit2','b1'),('unit3','b2'),('unit4','b3'),
    ('unit5','p1'),('unit6','outside1')) u(id,booking_id)`,
  unitServices: `SELECT * FROM (VALUES ('unit1','s1'),('unit1','s2'),('unit2','s1'),('unit3','s2'),
    ('unit4','s1'),('unit5','s1'),('unit6','s1')) us(booking_unit_id,service_id)`,
  services: `SELECT * FROM (VALUES ('s1','Old inactive cleaning','cat1',false),
    ('s2','Repair','cat2',true)) s(id,name,category_id,is_active)`,
  categories: `SELECT * FROM (VALUES ('cat1','Old inactive category',false),('cat2','Repair category',true)) c(id,name,is_active)`,
}

async function fixtureReport(query, overrides = {}) {
  const validated = validateCustomerStatisticsQuery(query)
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const { rows } = await client.query(buildCustomerStatisticsSql({ ...fixtureSources, ...overrides }),
      [validated.from, validated.to, validated.granularity, validated.search, validated.limit, (validated.page - 1) * validated.limit])
    await client.query('ROLLBACK')
    return presentCustomerStatistics(validated, { ...rows[0], asOf: rows[0].asOf.toISOString() })
  } finally { client.release() }
}

test('SELECT-only customer fixtures reconcile registration bounds, dual-role profiles and one default address without fanout',
  { skip: !enabled }, async () => {
    const data = await fixtureReport({ from: '2026-10-01', to: '2026-10-31' })
    assert.deepEqual(data.summary, { totalCustomers: 6, newCustomers: 2, activeCustomers: 3,
      lockedCustomers: 2, inactiveCustomers: 1, customersWithBookings: 5, customersWithoutBookings: 1 })
    assert.equal(data.acquisition.currentCount, 2)
    assert.equal(data.acquisition.previousCount, 2)
    assert.equal(data.acquisition.growthPercent, 0)
    assert.equal(data.acquisition.monthCount, 2)
    assert.equal(data.acquisition.yearCount, 5) // The current November profile is after the selected end date.
    assert.equal(data.acquisition.trend.length, 31)
    assert.equal(data.acquisition.trend[0].count, 1)
    assert.equal(data.acquisition.trend[30].count, 1)
    assert.equal(data.acquisition.trend.reduce((sum, point) => sum + point.count, 0), 2)
    assert.equal(data.areas.totalCustomers, 6)
    assert.equal(data.areas.knownCustomers, 3)
    assert.equal(data.areas.unknownCustomers, 3)
    assert.equal(data.areas.areaCount, 2)
    assert.equal(data.areas.averageCustomersPerArea, 1.5)
    assert.equal(data.areas.topArea.city, 'Alpha')
    assert.equal(data.areas.fastestGrowingArea, null)
    assert.equal(data.areas.items.reduce((sum, area) => sum + area.count, 0), 6)
    assert.deepEqual(data.areas.items.map((area) => area.count), [3, 2, 1])
    assert.equal(data.areas.items.some((area) => area.city === 'Ignore'), false)
    assert.equal(data.areas.items.filter((area) => area.ward === 'Same').length, 2)
  })

test('completed booking cohort counts service uses, customers and repeat usage independently of joins and inactive catalogs',
  { skip: !enabled }, async () => {
    const data = await fixtureReport({ from: '2026-10-01', to: '2026-10-31' })
    assert.equal(data.usage.totalBookings, 3)
    assert.equal(data.usage.distinctCustomers, 2)
    assert.equal(data.usage.totalUses, 5)
    assert.equal(data.usage.repeatCustomers, 1)
    assert.equal(data.usage.averageBookingsPerCustomer, 1.5)
    assert.equal(data.usage.repeatCustomerPercent, 50)
    assert.deepEqual(data.usage.services, [
      { id: 's1', name: 'Old inactive cleaning', count: 3, customers: 2, bookings: 2, percentage: 60 },
      { id: 's2', name: 'Repair', count: 2, customers: 1, bookings: 2, percentage: 40 },
    ])
    assert.equal(data.usage.categories[0].name, 'Old inactive category')
    assert.equal(data.usage.categories.reduce((sum, category) => sum + category.count, 0), 5)
    assert.equal(data.usage.services.reduce((sum, service) => sum + service.customers, 0), 3)
  })

test('customer cancellations exclude admin/technician/unknown actors; repeated rejected quotations and overlapping events count once',
  { skip: !enabled }, async () => {
    const data = await fixtureReport({ from: '2026-10-01', to: '2026-10-31' })
    assert.equal(data.cancellations.totalBookings, 16)
    assert.equal(data.cancellations.cancelledBookings, 1)
    assert.equal(data.cancellations.rejectedBookings, 3)
    assert.equal(data.cancellations.affectedBookings, 3)
    assert.equal(data.cancellations.cancellationPercent, 6.25)
    assert.equal(data.cancellations.rejectionPercent, 18.75)
    assert.equal(data.cancellations.trend.reduce((sum, point) => sum + point.totalBookings, 0), 16)
    assert.equal(data.cancellations.trend[14].cancelledBookings, 1)
    assert.equal(data.cancellations.trend[14].rejectedBookings, 3)
  })

test('locked search treats percent and underscore literally and affects no aggregate; pagination uses stable registration order',
  { skip: !enabled }, async () => {
    const all = await fixtureReport({ from: '2026-10-01', to: '2026-10-31' })
    const match = await fixtureReport({ from: '2026-10-01', to: '2026-10-31', search: '%_' })
    assert.equal(all.locked.total, 2)
    assert.equal(match.locked.total, 1)
    assert.equal(match.locked.items[0].id, 'c3')
    assert.deepEqual(match.summary, all.summary)
    assert.deepEqual(match.usage, all.usage)
    const next = await fixtureReport({ from: '2026-10-01', to: '2026-10-31', page: '2' })
    assert.equal(next.locked.total, 2)
    assert.deepEqual(next.locked.items, [])
    const noMatch = await fixtureReport({ from: '2026-10-01', to: '2026-10-31', search: "' OR true --" })
    assert.equal(noMatch.locked.total, 0)
    assert.deepEqual(noMatch.summary, all.summary)
  })

test('empty periods retain current account/default-area snapshot and null denominators with zero-filled daily/monthly buckets',
  { skip: !enabled }, async () => {
    const data = await fixtureReport({ from: '2025-12-01', to: '2025-12-03' })
    assert.equal(data.summary.totalCustomers, 6)
    assert.equal(data.summary.newCustomers, 0)
    assert.equal(data.acquisition.growthPercent, null)
    assert.deepEqual(data.acquisition.trend.map((item) => item.count), [0, 0, 0])
    assert.equal(data.usage.totalBookings, 0)
    assert.equal(data.usage.averageBookingsPerCustomer, null)
    assert.equal(data.usage.repeatCustomerPercent, null)
    assert.equal(data.cancellations.cancellationPercent, null)
    assert.equal(data.cancellations.rejectionPercent, null)
    const monthly = await fixtureReport({ from: '2026-07-15', to: '2026-10-15' })
    assert.equal(monthly.period.granularity, 'month')
    assert.deepEqual(monthly.acquisition.trend.map((item) => item.date), ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'])
    assert.equal(monthly.acquisition.currentCount, 3)
    assert.equal(monthly.acquisition.trend[2].count, 2)
    assert.equal(monthly.acquisition.trend[3].count, 1)
  })

test('two-tier city/ward addresses group independently without a district; empty databases yield coherent zero snapshots',
  { skip: !enabled }, async () => {
    const twoTier = await fixtureReport({ from: '2026-10-01', to: '2026-10-31' }, {
      addresses: `SELECT * FROM (VALUES ('a1','c1','Alpha',NULL::text,'Same',true),
        ('a2','c2','Beta',NULL::text,'Same',true)) a(id,customer_id,city,district,ward,is_default)`,
    })
    assert.equal(twoTier.areas.areaCount, 2)
    assert.equal(twoTier.areas.knownCustomers, 2)
    assert.equal(twoTier.areas.unknownCustomers, 4)
    assert.ok(twoTier.areas.items.filter((area) => !area.missing).every((area) => area.district === null))
    const empty = await fixtureReport({ from: '2026-10-01', to: '2026-10-01' }, {
      customers: "SELECT NULL::text AS id,NULL::text AS user_id,NULL::timestamptz AS created_at WHERE false",
    })
    assert.equal(empty.summary.totalCustomers, 0)
    assert.equal(empty.summary.newCustomers, 0)
    assert.equal(empty.areas.unknownCustomers, 0)
    assert.deepEqual(empty.areas.items, [])
    assert.equal(empty.usage.totalBookings, 0)
    assert.equal(empty.cancellations.totalBookings, 0)
    assert.equal(empty.locked.total, 0)
    assert.deepEqual(empty.locked.items, [])
  })

test('locked table pages contain every matching customer once with deterministic ties and retain full snapshot totals',
  { skip: !enabled }, async () => {
    const sources = {
      customers: `SELECT 'c'||lpad(i::text,2,'0') AS id,'u'||lpad(i::text,2,'0') AS user_id,
        '2026-10-01 00:00:00+07'::timestamptz AS created_at FROM generate_series(1,12) i`,
      users: `SELECT 'u'||lpad(i::text,2,'0') AS id,'Locked '||i AS full_name,'locked'||i||'@example.com' AS email,
        NULL::text AS phone,NULL::text AS avatar_url,1::smallint AS status FROM generate_series(1,12) i`,
    }
    const first = await fixtureReport({ from: '2026-10-01', to: '2026-10-31' }, sources)
    const second = await fixtureReport({ from: '2026-10-01', to: '2026-10-31', page: '2' }, sources)
    assert.equal(first.locked.total, 12)
    assert.equal(first.summary.lockedCustomers, 12)
    assert.equal(first.locked.items.length, 10)
    assert.equal(second.locked.items.length, 2)
    assert.deepEqual(second.locked.items.map((item) => item.id), ['c11', 'c12'])
    assert.equal(new Set([...first.locked.items, ...second.locked.items].map((item) => item.id)).size, 12)
    assert.deepEqual(second.summary, first.summary)
  })

test('fixed UTC+7 registration and booking buckets work at 1900 and 9999 without date overflow', { skip: !enabled }, async () => {
  for (const date of ['1900-01-01', '9999-12-31']) {
    const data = await fixtureReport({ from: date, to: date }, {
      customers: `SELECT 'c1'::text AS id,'u1'::text AS user_id,'${date} 00:00:00+07'::timestamptz AS created_at`,
      bookings: `SELECT 'b1'::text AS id,'c1'::text AS customer_id,'${date} 00:00:00+07'::timestamptz AS created_at,
        9::smallint AS status,NULL::text AS cancelled_by_id`,
    })
    assert.equal(data.summary.totalCustomers, 1)
    assert.equal(data.summary.newCustomers, 1)
    assert.equal(data.acquisition.trend[0].date, date)
    assert.equal(data.acquisition.trend[0].count, 1)
    assert.equal(data.cancellations.totalBookings, 1)
    assert.equal(data.cancellations.trend[0].date, date)
  }
})

test('live schema report reconciles independent read-only queries without changing customer, booking, quotation or financial tables',
  { skip: !enabled }, async () => {
    const tables = ['users', 'customer_profiles', 'customer_addresses', 'bookings', 'booking_units', 'booking_unit_services',
      'quotations', 'services', 'service_categories', 'payments', 'technician_accounts', 'technician_topups', 'withdrawals']
    const checksum = async () => Promise.all(tables.map(async (table) => (await pool.query(
      `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) AS checksum FROM ${table} t`)).rows[0].checksum))
    const before = await checksum()
    const data = await new CustomerStatisticsService(new CustomerStatisticsRepository(), { audit: () => {} })
      .getCustomerStatistics({ from: '2026-01-01', to: '2026-12-31' }, 'readonly-customer-statistics-test')
    const { rows: [expected] } = await pool.query(`SELECT
      (SELECT count(*) FROM customer_profiles c JOIN users u ON u.id=c.user_id)::text AS customers,
      (SELECT count(*) FROM customer_profiles c JOIN users u ON u.id=c.user_id WHERE u.status='LOCKED')::text AS locked,
      (SELECT count(*) FROM bookings b JOIN customer_profiles c ON c.id=b.customer_id
        WHERE b.created_at>='2026-01-01 00:00:00+07'::timestamptz AND b.created_at<'2027-01-01 00:00:00+07'::timestamptz)::text AS bookings,
      (SELECT count(*) FROM bookings b JOIN customer_profiles c ON c.id=b.customer_id
        WHERE b.created_at>='2026-01-01 00:00:00+07'::timestamptz AND b.created_at<'2027-01-01 00:00:00+07'::timestamptz
        AND b.status='COMPLETED')::text AS completed,
      (SELECT count(*) FROM bookings b JOIN booking_units u ON u.booking_id=b.id
        JOIN booking_unit_services s ON s.booking_unit_id=u.id
        WHERE b.created_at>='2026-01-01 00:00:00+07'::timestamptz AND b.created_at<'2027-01-01 00:00:00+07'::timestamptz
        AND b.status='COMPLETED')::text AS uses`)
    assert.equal(data.summary.totalCustomers, Number(expected.customers))
    assert.equal(data.summary.lockedCustomers, Number(expected.locked))
    assert.equal(data.locked.total, Number(expected.locked))
    assert.equal(data.cancellations.totalBookings, Number(expected.bookings))
    assert.equal(data.usage.totalBookings, Number(expected.completed))
    assert.equal(data.usage.totalUses, Number(expected.uses))
    assert.equal(data.areas.items.reduce((sum, area) => sum + area.count, 0), data.summary.totalCustomers)
    assert.equal(data.summary.activeCustomers + data.summary.lockedCustomers + data.summary.inactiveCustomers, data.summary.totalCustomers)
    assert.equal(data.summary.customersWithBookings + data.summary.customersWithoutBookings, data.summary.totalCustomers)
    assert.equal(data.acquisition.trend.reduce((sum, point) => sum + point.count, 0), data.acquisition.currentCount)
    assert.equal(data.cancellations.trend.reduce((sum, point) => sum + point.totalBookings, 0), data.cancellations.totalBookings)
    assert.deepEqual(await checksum(), before)
  })

test.after(async () => { await pool.end() })
