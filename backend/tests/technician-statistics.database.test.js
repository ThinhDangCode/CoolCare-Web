import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { buildTechnicianStatisticsSql, TechnicianStatisticsRepository } from '../src/modules/technician-statistics/technician-statistics.repository.js'
import { presentTechnicianStatistics, TechnicianStatisticsService } from '../src/modules/technician-statistics/technician-statistics.service.js'
import { validateTechnicianStatisticsQuery } from '../src/modules/technician-statistics/technician-statistics.validation.js'
import { revenueUnits } from '../src/modules/revenue/revenue.money.js'

const enabled = process.env.RUN_TECHNICIAN_STATISTICS_DB_TESTS === '1'
const range = { from: '2026-10-01', to: '2026-10-31' }
const sources = {
  technicians: `SELECT * FROM (VALUES
    ('t1','u1',true,1,'2026-01-01'::timestamptz),
    ('t2','u2',true,1,'2026-01-02 00:00:00+07'::timestamptz),
    ('t3','u3',false,0,'2026-01-03'::timestamptz),
    ('t4','u4',true,1,'2026-01-04'::timestamptz),
    ('t5','u5',true,1,'2026-01-05'::timestamptz)
  ) t(id,user_id,is_active,verification_status,created_at)`,
  users: `SELECT * FROM (VALUES
    ('u1','Customer and technician','one@example.com',NULL::text,NULL::text,0),
    ('u2','Literal %_ locked','two@example.com','0901234567',NULL,1),
    ('u3','Pending draft','three@example.com',NULL,NULL,0),
    ('u4','Inactive account','four@example.com',NULL,NULL,2),
    ('u5','Zero earning','five@example.com',NULL,NULL,0)
  ) u(id,full_name,email,phone,avatar_url,status)`,
  areas: `SELECT * FROM (VALUES ('t1','Alpha','One'),('t1','Alpha','Two'),('t1','Alpha','One'),
    ('t2','Alpha','One'),('t3','Beta','One'),('t4','Alpha',NULL::text),('t4',' ','Missing')) a(technician_id,city,ward)`,
  assignments: `SELECT * FROM (VALUES
    ('a01','b1','t1',6,'2026-09-30 17:00:00+00'::timestamptz,NULL::timestamptz),
    ('a02','b2','t1',2,'2026-10-02 00:00:00+07'::timestamptz,NULL),
    ('a03','b3','t1',3,'2026-10-03 00:00:00+07'::timestamptz,NULL),
    ('a04','b4','t2',7,'2026-10-04 00:00:00+07'::timestamptz,NULL),
    ('a05','b5','t1',7,'2026-10-05 00:00:00+07'::timestamptz,NULL),
    ('a06','b6','t3',1,'2026-10-06 00:00:00+07'::timestamptz,NULL),
    ('a07','b7','t3',5,'2026-10-07 00:00:00+07'::timestamptz,NULL),
    ('a08','b8','t1',0,'2026-10-08 00:00:00+07'::timestamptz,NULL),
    ('a09','b9','t1',4,'2026-10-09 00:00:00+07'::timestamptz,NULL),
    ('a10','b10','t1',6,'2026-09-30 16:59:59.999+00'::timestamptz,NULL),
    ('a11','b11','t1',6,'2026-10-31 17:00:00+00'::timestamptz,NULL),
    ('a12','b12','t1',1,'2026-10-07 00:00:00+07'::timestamptz,NULL),
    ('a13','b12','t1',3,'2026-10-08 00:00:00+07'::timestamptz,NULL),
    ('a14','b1','t2',3,'2026-10-09 00:00:00+07'::timestamptz,NULL),
    ('a15','b13','t1',6,'2026-10-10 00:00:00+07'::timestamptz,NULL),
    ('a16','b14','t1',1,'2026-10-10 00:00:00+07'::timestamptz,NULL),
    ('a17','b14','t1',2,'2026-11-01 00:00:00+07'::timestamptz,NULL)
  ) a(id,booking_id,technician_id,status,requested_at,responded_at)`,
  bookings: `SELECT * FROM (VALUES ('b1',9,NULL::text),('b2',3,NULL),
    ('b3',10,'u1'),('b4',10,'customer'),('b5',10,'u1'),
    ('b6',0,NULL),('b7',0,NULL),('b8',0,NULL),('b9',0,NULL),
    ('b10',9,NULL),('b11',9,NULL),('b12',0,NULL),('b13',3,NULL),
    ('b14',2,NULL)) b(id,status,cancelled_by_id)`,
  history: `SELECT * FROM (VALUES
    ('b5',2,'u1','2026-10-05 01:00:00+07'::timestamptz),
    ('b5',2,'u1','2026-10-05 01:01:00+07'::timestamptz),
    ('b4',2,'u2','2026-09-30 00:00:00+07'::timestamptz),
    ('b6',2,'u1','2026-10-06 01:00:00+07'::timestamptz),
    ('b12',2,'u1','2026-10-07 11:00:00+07'::timestamptz),
    ('b3',2,'u1','2026-09-30 00:00:00+07'::timestamptz)
  ) h(booking_id,status,changed_by_id,created_at)`,
  payments: `SELECT * FROM (VALUES
    ('p1','b1','t1',2,'2026-09-30 17:00:00+00'::timestamptz,100.01::numeric),
    ('p2','b1','t1',2,'2026-10-02 00:00:00+07'::timestamptz,50.00),
    ('p3','b10','t2',2,'2026-10-03 00:00:00+07'::timestamptz,200.00),
    ('p4','b2','t1',2,NULL::timestamptz,30.00),
    ('p5','b2','t1',3,'2026-10-04 00:00:00+07'::timestamptz,999.00),
    ('p6','b5','t5',2,'2026-10-04 00:00:00+07'::timestamptz,0.00),
    ('p7','b1','t1',2,'2026-09-30 16:59:59.999+00'::timestamptz,999.00),
    ('p8','b1','t1',2,'2026-10-31 17:00:00+00'::timestamptz,999.00),
    ('p9','b1',NULL::text,2,'2026-10-02 00:00:00+07'::timestamptz,999.00)
  ) p(id,booking_id,technician_id,payment_status,settled_at,technician_earning)`,
  reviews: `SELECT * FROM (VALUES
    ('r1','t1',0,5,'2026-09-30 17:00:00+00'::timestamptz),
    ('r2','t1',0,5,'2026-10-02 00:00:00+07'::timestamptz),
    ('r3','t2',0,1,'2026-10-03 00:00:00+07'::timestamptz),
    ('r4','t1',1,5,'2026-10-03 00:00:00+07'::timestamptz),
    ('r5','t1',0,5,'2026-10-31 17:00:00+00'::timestamptz)
  ) r(id,technician_id,status,rating,created_at)`,
  complaints: `SELECT * FROM (VALUES
    ('c1','t1',0,'2026-10-01 00:00:00+07'::timestamptz),
    ('c2','t1',2,'2026-10-02 00:00:00+07'::timestamptz),
    ('c3','t2',4,'2026-10-03 00:00:00+07'::timestamptz),
    ('c4','t2',3,'2026-10-04 00:00:00+07'::timestamptz),
    ('c5','t3',1,'2026-10-05 00:00:00+07'::timestamptz),
    ('c6',NULL::text,0,'2026-10-05 00:00:00+07'::timestamptz),
    ('c7','not-linked',0,'2026-10-05 00:00:00+07'::timestamptz),
    ('c8','t1',0,'2026-10-31 17:00:00+00'::timestamptz)
  ) c(id,technician_id,status,created_at)`,
  penalties: `SELECT * FROM (VALUES ('x1','t1','2026-10-01 00:00:00+07'::timestamptz),
    ('x2','t1','2026-10-03 00:00:00+07'::timestamptz),('x3','t4','2026-10-04 00:00:00+07'::timestamptz),
    ('x4','t1','2026-09-30 16:59:59.999+00'::timestamptz)) p(id,technician_id,applied_at)`,
}

async function fixtureReport(query = range, overrides = {}) {
  const validated = validateTechnicianStatisticsQuery(query)
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const { rows } = await client.query(buildTechnicianStatisticsSql({ ...sources, ...overrides }),
      [validated.from, validated.to, validated.granularity, validated.search, validated.limit, (validated.page - 1) * validated.limit])
    await client.query('ROLLBACK')
    return presentTechnicianStatistics(validated, { ...rows[0], asOf: rows[0].asOf.toISOString() })
  } finally { client.release() }
}
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0)

test('SELECT-only fixtures preserve dual-role technician snapshots and overlapping city/ward coverage without fanout',
  { skip: !enabled }, async () => {
    const data = await fixtureReport()
    assert.deepEqual(data.summary, { totalTechnicians: 5, activeTechnicians: 2, inactiveTechnicians: 2,
      verifiedTechnicians: 4, lockedTechnicians: 1, pendingVerification: 1, rejectedVerification: 0 })
    assert.equal(data.areas.areaCount, 3)
    assert.equal(data.areas.coveredTechnicians, 3)
    assert.equal(data.areas.unassignedTechnicians, 2)
    assert.equal(data.areas.coverageAssignments, 4)
    assert.equal(data.areas.averageTechniciansPerArea, 1.33)
    assert.equal(data.areas.topArea.count, 2)
    assert.equal(data.areas.topArea.percentage, 40)
    assert.equal(data.areas.items.filter((item) => item.ward === 'One').length, 2)
  })

test('request cohort excludes recommendations, deduplicates retries, preserves reassignment and attributes cancellation actors',
  { skip: !enabled }, async () => {
    const { activity } = await fixtureReport()
    assert.equal(activity.totalRequests, 10)
    assert.equal(activity.acceptedRequests, 4)
    assert.equal(activity.completedRequests, 1)
    assert.equal(activity.declinedRequests, 3)
    assert.equal(activity.technicianCancelledRequests, 1)
    assert.equal(activity.otherCancelledRequests, 1)
    assert.equal(activity.pendingRequests, 1)
    assert.equal(activity.expiredRequests, 1)
    assert.equal(activity.completionPercent, 10)
    assert.equal(activity.trend.length, 31)
    for (const key of ['totalRequests', 'acceptedRequests', 'completedRequests', 'declinedRequests', 'technicianCancelledRequests']) {
      assert.equal(sum(activity.trend, key), activity[key])
    }
    assert.equal(activity.trend[0].completedRequests, 1)
    assert.equal(activity.trend[6].totalRequests, 1) // Expired request only; retry's old row is gone.
    assert.equal(activity.trend[9].acceptedRequests, 1) // Newer request in November excludes the older pair.
  })

test('declining a selected request cancels the booking without becoming a cancellation of accepted work',
  { skip: !enabled }, async () => {
    const { activity } = await fixtureReport(range, {
      assignments: `SELECT * FROM (VALUES
        ('decline','declined-job','t1',3,'2026-10-03 00:00:00+07'::timestamptz,'2026-10-03 00:10:00+07'::timestamptz),
        ('cancel','cancelled-job','t1',7,'2026-10-04 00:00:00+07'::timestamptz,'2026-10-04 00:10:00+07'::timestamptz),
        ('customer','customer-job','t2',7,'2026-10-05 00:00:00+07'::timestamptz,NULL::timestamptz)
      ) a(id,booking_id,technician_id,status,requested_at,responded_at)`,
      bookings: `SELECT * FROM (VALUES
        ('declined-job',10,'u1'),('cancelled-job',10,'u1'),('customer-job',10,'customer')
      ) b(id,status,cancelled_by_id)`,
      history: `SELECT 'cancelled-job'::text AS booking_id,2::smallint AS status,'u1'::text AS changed_by_id,
        '2026-10-04 00:10:00+07'::timestamptz AS created_at`,
    })
    assert.equal(activity.totalRequests, 3)
    assert.equal(activity.declinedRequests, 1)
    assert.equal(activity.technicianCancelledRequests, 1)
    assert.equal(activity.otherCancelledRequests, 1)
    assert.equal(activity.acceptedRequests, 1) // History preserves acceptance before cancellation.
    const declinedDay = activity.trend.find((row) => row.date === '2026-10-03')
    assert.equal(declinedDay.declinedRequests, 1)
    assert.equal(declinedDay.technicianCancelledRequests, 0)
    assert.equal(activity.trend.find((row) => row.date === '2026-10-04').technicianCancelledRequests, 1)
  })

test('settled entitlement is exact, independent of multi-valued joins and uses eligible technicians including zero earners',
  { skip: !enabled }, async () => {
    const { income } = await fixtureReport()
    assert.equal(income.amount, '350.01')
    assert.equal(income.knownAmount, '350.01')
    assert.equal(income.missingPayments, 0)
    assert.equal(income.settledPayments, 4)
    assert.equal(income.earningTechnicians, 3)
    assert.equal(income.averageAmount, '116.67')
    assert.equal(income.topTechnician.id, 't2')
    assert.equal(income.topTechnician.amount, '200.00')
    assert.equal(income.completedJobs, 2) // Two payments for b1 still count one completed job.
    assert.equal(sum(income.trend, 'settledPayments'), 4)
    assert.equal(income.trend[0].amount, '100.01')
  })

test('incomplete entitlement snapshots never masquerade as zero income or a definite top technician',
  { skip: !enabled }, async () => {
    const data = await fixtureReport(range, { payments: sources.payments.replace('50.00)', 'NULL::numeric)') })
    assert.equal(data.income.amount, null)
    assert.equal(data.income.knownAmount, '300.01')
    assert.equal(data.income.averageAmount, null)
    assert.equal(data.income.topTechnician, null)
    assert.equal(data.income.missingPayments, 1)
    assert.equal(data.income.trend[1].amount, null)
    assert.equal(data.income.trend[1].knownAmount, '0.00')
    assert.equal(data.income.trend[2].amount, '200.00')
  })

test('published reviews are weighted independently; complaint and penalty records overlap without duplicated sources',
  { skip: !enabled }, async () => {
    const { activity, issues } = await fixtureReport()
    assert.equal(activity.reviewCount, 3)
    assert.equal(activity.averageRating, 3.67)
    assert.equal(sum(activity.trend, 'reviewCount'), 3)
    assert.equal(activity.trend[0].averageRating, 5)
    assert.equal(activity.trend[3].averageRating, null)
    assert.equal(issues.complaints, 5)
    assert.equal(issues.penalties, 3)
    assert.equal(issues.totalIssues, 8)
    assert.equal(issues.openComplaints, 2)
    assert.equal(issues.resolvedComplaints, 1)
    assert.equal(issues.closedComplaints, 1)
    assert.equal(issues.rejectedComplaints, 1)
    assert.equal(issues.affectedTechnicians, 4)
    assert.equal(sum(issues.trend, 'complaints'), 5)
    assert.equal(sum(issues.trend, 'penalties'), 3)
    assert.equal(sum(issues.trend, 'resolvedComplaints'), 1)
  })

test('locked-table literal search and stable pagination leave aggregate metrics unchanged',
  { skip: !enabled }, async () => {
    const base = await fixtureReport()
    const matched = await fixtureReport({ ...range, search: '%_' })
    assert.equal(matched.locked.total, 1)
    assert.equal(matched.locked.items[0].name, 'Literal %_ locked')
    assert.equal(new Date(matched.locked.items[0].registeredAt).toISOString(), '2026-01-01T17:00:00.000Z')
    const missing = await fixtureReport({ ...range, search: "' OR true --", page: '2', limit: '20' })
    assert.equal(missing.locked.total, 0)
    assert.deepEqual(missing.locked.items, [])
    assert.deepEqual(missing.summary, base.summary)
    assert.deepEqual(missing.income, base.income)
    assert.deepEqual(missing.activity, base.activity)
    const overrides = {
      technicians: `SELECT 't'||lpad(i::text,2,'0') AS id,'u'||lpad(i::text,2,'0') AS user_id,
        true AS is_active,1::smallint AS verification_status,'2026-01-01'::timestamptz AS created_at FROM generate_series(1,12) i`,
      users: `SELECT 'u'||lpad(i::text,2,'0') AS id,'Locked '||i AS full_name,NULL::text AS email,
        NULL::text AS phone,NULL::text AS avatar_url,1::smallint AS status FROM generate_series(1,12) i`,
    }
    const first = await fixtureReport(range, overrides)
    const second = await fixtureReport({ ...range, page: '2' }, overrides)
    assert.equal(first.locked.total, 12)
    assert.equal(first.locked.items.length, 10)
    assert.equal(second.locked.items.length, 2)
    assert.equal(new Set([...first.locked.items, ...second.locked.items].map((item) => item.id)).size, 12)
    assert.deepEqual(second.locked.items.map((item) => item.id), ['t11', 't12'])
  })

test('empty historical periods retain current snapshots and zero-fill daily/monthly buckets without artificial rates',
  { skip: !enabled }, async () => {
    for (const query of [{ from: '1900-01-01', to: '1900-01-01' }, { from: '9999-12-31', to: '9999-12-31' },
      { from: '2000-01-15', to: '2000-12-15' }]) {
      const data = await fixtureReport(query)
      assert.equal(data.summary.totalTechnicians, 5)
      assert.equal(data.areas.areaCount, 3)
      assert.equal(data.income.amount, '0.00')
      assert.equal(data.income.averageAmount, null)
      assert.equal(data.income.topTechnician, null)
      assert.equal(data.activity.totalRequests, 0)
      assert.equal(data.activity.completionPercent, null)
      assert.equal(data.activity.averageRating, null)
      assert.equal(data.issues.totalIssues, 0)
      assert.equal(sum(data.income.trend, 'settledPayments'), 0)
      assert.equal(data.income.trend.length, query.from === '2000-01-15' ? 12 : 1)
    }
  })

test('live-schema independent totals reconcile while all business table checksums remain unchanged',
  { skip: !enabled }, async () => {
    const tables = ['users', 'customer_profiles', 'technician_profiles', 'technician_areas', 'booking_technicians',
      'booking_status_history', 'bookings', 'payments', 'reviews', 'complaints', 'technician_penalties',
      'technician_accounts', 'settlement_transactions', 'technician_topups', 'withdrawals']
    async function checksum() {
      const result = {}
      for (const table of tables) result[table] = (await pool.query(`SELECT count(*)::text AS count,
        md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) AS md5 FROM ${table} t`)).rows[0]
      return result
    }
    const before = await checksum()
    const data = await new TechnicianStatisticsService(new TechnicianStatisticsRepository(), { audit: () => {} })
      .getTechnicianStatistics({ from: '2026-01-01', to: '2026-12-31' }, 'read-only-technician-test')
    const { rows: [expected] } = await pool.query(`SELECT
      (SELECT count(*) FROM technician_profiles t JOIN users u ON u.id=t.user_id)::text AS technicians,
      (SELECT count(*) FROM technician_profiles t JOIN users u ON u.id=t.user_id WHERE u.status='LOCKED')::text AS locked,
      (SELECT COALESCE(sum(p.technician_earning),0) FROM payments p JOIN technician_profiles t ON t.id=p.technician_id
        JOIN users u ON u.id=t.user_id WHERE p.payment_status='SUCCESS' AND p.settled_at>='2026-01-01 00:00:00+07'::timestamptz
        AND p.settled_at<'2027-01-01 00:00:00+07'::timestamptz)::text AS earning,
      (SELECT count(*) FROM reviews r JOIN technician_profiles t ON t.id=r.technician_id JOIN users u ON u.id=t.user_id
        WHERE r.status='PUBLISHED' AND r.created_at>='2026-01-01 00:00:00+07'::timestamptz
        AND r.created_at<'2027-01-01 00:00:00+07'::timestamptz)::text AS reviews`)
    assert.equal(data.summary.totalTechnicians, Number(expected.technicians))
    assert.equal(data.summary.lockedTechnicians, Number(expected.locked))
    assert.equal(revenueUnits(data.income.knownAmount), revenueUnits(expected.earning))
    assert.equal(data.activity.reviewCount, Number(expected.reviews))
    assert.equal(data.activity.trend.length, 12)
    assert.deepEqual(await checksum(), before)
  })

test.after(async () => { await pool.end() })
