import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { TopupsRepository } from '../src/modules/topups/topups.repository.js'
import { validateTopupListQuery } from '../src/modules/topups/topups.validation.js'

const enabled = process.env.RUN_TOPUPS_DB_TESTS === '1'

test(
  'local top-up history preserves exact money/methods/nullable snapshots and owned ledger with unchanged financial tables',
  { skip: !enabled },
  async () => {
    const repository = new TopupsRepository()
    const list = (query) => repository.listTopups(validateTopupListQuery(query))
    const tables = [
      'technician_topups',
      'technician_accounts',
      'settlement_transactions',
      'withdrawals',
      'payments',
      'payment_methods',
      'settlements',
      'settlement_items',
      'users',
      'technician_profiles',
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
    const expected = (
      await pool.query(`SELECT t.*,u.full_name,u.phone,pm.code AS method_code,pm.name AS method_name,
      (t.created_at AT TIME ZONE INTERVAL '+07:00')::date::text AS vietnam_date
      FROM technician_topups t JOIN technician_profiles tp ON tp.id=t.technician_id JOIN users u ON u.id=tp.user_id
      JOIN payment_methods pm ON pm.id=t.payment_method_id ORDER BY t.created_at DESC,t.id DESC`)
    ).rows
    assert.ok(expected.length > 0, 'Needs existing local top-up fixtures')
    const all = await list({ limit: '100' })
    assert.equal(all.pagination.total, expected.length)
    assert.deepEqual(
      all.items.map((item) => item.id),
      expected.slice(0, 100).map((item) => item.id)
    )
    const methods = (
      await pool.query(`SELECT DISTINCT pm.id,pm.code,pm.name FROM payment_methods pm
      JOIN technician_topups t ON t.payment_method_id=pm.id ORDER BY pm.name,pm.id`)
    ).rows
    assert.deepEqual(all.options.methods, methods)
    for (const fixture of expected.slice(0, 100)) {
      const item = all.items.find((item) => item.id === fixture.id)
      assert.equal(item.topupCode, fixture.topup_code)
      assert.equal(item.amount, fixture.amount)
      assert.equal(typeof item.amount, 'string')
      assert.equal(item.status, fixture.payment_status)
      assert.equal(item.transactionReference, fixture.transaction_reference)
      assert.deepEqual(item.technician, {
        id: fixture.technician_id,
        name: fixture.full_name,
        phone: fixture.phone,
      })
      assert.deepEqual(item.method, {
        id: fixture.payment_method_id,
        code: fixture.method_code,
        name: fixture.method_name,
      })
      const detail = await repository.getTopup(fixture.id)
      assert.equal(detail.createdAt.getTime(), fixture.created_at.getTime())
      assert.equal(detail.paidAt?.getTime(), fixture.paid_at?.getTime())
      assert.equal(detail.settledAt?.getTime(), fixture.settled_at?.getTime())
      assert.equal(detail.closureVerifiedAt?.getTime(), fixture.closure_verified_at?.getTime())
      assert.equal(detail.closureReference, fixture.closure_reference)
      const ledger =
        (
          await pool.query(
            `SELECT st.id,st.transaction_type AS type,st.amount,st.balance_before AS "balanceBefore",
        st.balance_after AS "balanceAfter",st.created_at AS "createdAt",st.reference_id AS "referenceId"
        FROM settlement_transactions st JOIN technician_accounts a ON a.id=st.technician_account_id
        JOIN technician_topups t ON t.id=st.topup_id
        WHERE st.topup_id=$1 AND st.transaction_type='TOP_UP' AND st.technician_account_id=$2 AND a.technician_id=$3 AND t.payment_status='SUCCESS'`,
            [fixture.id, fixture.technician_account_id, fixture.technician_id]
          )
        ).rows[0] ?? null
      assert.deepEqual(detail.ledger, ledger)
      assert.equal('idempotency_key' in detail, false)
      assert.equal('closureReference' in item, false)
      for (const search of [
        fixture.id,
        fixture.topup_code,
        fixture.transaction_reference,
        fixture.full_name,
        fixture.phone,
      ])
        if (search)
          assert.ok(
            (await list({ search, limit: '100' })).items.some((item) => item.id === fixture.id)
          )
      const filtered = await list({
        method: fixture.payment_method_id,
        status: fixture.payment_status,
        from: fixture.vietnam_date,
        to: fixture.vietnam_date,
        limit: '100',
      })
      assert.deepEqual(
        filtered.items.map((item) => item.id),
        expected
          .filter(
            (item) =>
              item.payment_method_id === fixture.payment_method_id &&
              item.payment_status === fixture.payment_status &&
              item.vietnam_date === fixture.vietnam_date
          )
          .slice(0, 100)
          .map((item) => item.id)
      )
    }
    for (const status of ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'])
      assert.equal(
        (await list({ status })).pagination.total,
        expected.filter((item) => item.payment_status === status).length
      )
    for (const search of ['%', '_', '\\', "' OR 1=1 --"]) {
      const matches = expected.filter((item) =>
        [item.id, item.topup_code, item.transaction_reference, item.full_name, item.phone].some(
          (value) => value?.toLowerCase().includes(search.toLowerCase())
        )
      )
      assert.deepEqual(
        (await list({ search, limit: '100' })).items.map((item) => item.id),
        matches.slice(0, 100).map((item) => item.id)
      )
    }
    const unused = (
      await pool.query(
        `SELECT id FROM payment_methods pm WHERE NOT EXISTS(SELECT 1 FROM technician_topups t WHERE t.payment_method_id=pm.id) ORDER BY id LIMIT 1`
      )
    ).rows[0]
    if (unused) {
      const empty = await list({ method: unused.id })
      assert.equal(empty.pagination.total, 0)
      assert.deepEqual(empty.items, [])
      assert.ok(empty.options.methods.some((method) => method.id === unused.id))
    }
    await assert.rejects(list({ method: '00000000-0000-0000-0000-000000000000' }), { status: 422 })
    const empty = await list({ search: 'No matching synthetic top-up 123456789' })
    assert.equal(empty.pagination.total, 0)
    assert.deepEqual(empty.options.methods, methods)
    assert.equal(await repository.getTopup('00000000-0000-0000-0000-000000000000'), null)
    assert.deepEqual(await checksum(), before)
  }
)

const techA = '20000000-0000-0000-0000-000000000001'
const techB = '20000000-0000-0000-0000-000000000002'
const accountA = '30000000-0000-0000-0000-000000000001'
const accountB = '30000000-0000-0000-0000-000000000002'
const methodA = '40000000-0000-0000-0000-000000000001'
const methodB = '40000000-0000-0000-0000-000000000002'
const unusedMethod = '40000000-0000-0000-0000-000000000003'
const topupId = (ordinal) => `10000000-0000-0000-0000-${String(ordinal).padStart(12, '0')}`
const fixtureSql = `WITH technician_topups AS (
    SELECT ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid AS id,'SYNTHETIC-TOPUP-'||i::text AS topup_code,
      '${techA}'::uuid AS technician_id,CASE WHEN i=3 THEN '${accountB}'::uuid ELSE '${accountA}'::uuid END AS technician_account_id,
      CASE WHEN i IN(5,6) THEN '${methodB}'::uuid ELSE '${methodA}'::uuid END AS payment_method_id,150000.00::numeric AS amount,
      CASE i WHEN 1 THEN 'PENDING' WHEN 5 THEN 'FAILED' WHEN 6 THEN 'CANCELLED' WHEN 7 THEN 'PROCESSING' WHEN 9 THEN 'PENDING' ELSE 'SUCCESS' END AS payment_status,
      CASE WHEN i IN(2,3,4,8) THEN 'SYNTHETIC-PROVIDER-'||i::text ELSE NULL END AS transaction_reference,
      CASE i WHEN 6 THEN '2026-10-01 23:59:59+07'::timestamptz WHEN 7 THEN '2026-10-02 00:00:00+07'::timestamptz
        WHEN 8 THEN '2026-09-30 23:59:59+07'::timestamptz ELSE '2026-10-01 00:00:00+07'::timestamptz END AS created_at,
      CASE WHEN i IN(2,3,4,8) THEN '2026-10-02 12:00:00+07'::timestamptz ELSE NULL END AS paid_at,
      CASE WHEN i IN(2,3,4,8) THEN '2026-10-02 12:00:01+07'::timestamptz ELSE NULL END AS settled_at,
      CASE WHEN i IN(5,6) THEN '2026-10-02 12:00:00+07'::timestamptz ELSE NULL END AS closure_verified_at,
      CASE WHEN i IN(5,6) THEN 'SYNTHETIC-CLOSURE-'||i::text ELSE NULL END AS closure_reference
      FROM generate_series(1,9) i
  ), technician_profiles AS (SELECT '${techA}'::uuid AS id,'${techA}'::uuid AS user_id),
  users AS (SELECT '${techA}'::uuid AS id,'Synthetic%_\\ Actor'::text AS full_name,'0900000000'::text AS phone),
  payment_methods AS (SELECT * FROM (VALUES
    ('${methodA}'::uuid,'LEGACY_GATEWAY','Legacy inactive gateway',false,true),
    ('${methodB}'::uuid,'CUSTOM_GATEWAY','Custom gateway',true,true),
    ('${unusedMethod}'::uuid,'UNUSED_GATEWAY','Unused gateway',true,true)
  ) AS pm(id,code,name,is_active,is_online)),
  technician_accounts AS (SELECT * FROM (VALUES('${accountA}'::uuid,'${techA}'::uuid,999999.00::numeric),
    ('${accountB}'::uuid,'${techB}'::uuid,999999.00::numeric)) AS a(id,technician_id,settlement_balance)),
  settlement_transactions AS (
    SELECT ('50000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid AS id,
      ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid AS topup_id,
      CASE WHEN i IN(3,4) THEN '${accountB}'::uuid ELSE '${accountA}'::uuid END AS technician_account_id,
      CASE WHEN i=8 THEN 'WITHDRAWAL' ELSE 'TOP_UP' END AS transaction_type,
      150000.00::numeric AS amount,-100000.00::numeric AS balance_before,50000.00::numeric AS balance_after,
      '2026-10-02 12:00:01+07'::timestamptz AS created_at,NULL::text AS reference_id
    FROM (VALUES(2),(3),(4),(8),(9)) fixture(i)
  ) `

test(
  'production queries with SELECT-only synthetic CTEs cover all states, inactive methods, nullable snapshots and ledger owner/type/status isolation',
  { skip: !enabled },
  async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const repository = new TopupsRepository({
        transaction: async (work) =>
          work({
            query: (sql, values) =>
              sql.startsWith('SET TRANSACTION')
                ? Promise.resolve({ rows: [] })
                : client.query(`${fixtureSql}${sql}`, values),
          }),
      })
      const list = (query) => repository.listTopups(validateTopupListQuery(query))
      const all = await list({ limit: '100' })
      assert.equal(all.pagination.total, 9)
      assert.deepEqual(
        all.options.methods.map((method) => method.id).sort(),
        [methodA, methodB].sort()
      )
      assert.equal(
        all.options.methods.find((method) => method.id === methodA).code,
        'LEGACY_GATEWAY'
      )
      for (const ordinal of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const detail = await repository.getTopup(topupId(ordinal))
        assert.equal(detail.id, topupId(ordinal))
        if (ordinal === 2) {
          assert.equal(detail.ledger.amount, '150000.00')
          assert.equal(detail.ledger.balanceBefore, '-100000.00')
          assert.equal(detail.ledger.balanceAfter, '50000.00')
          assert.notEqual(detail.ledger.balanceAfter, '999999.00')
        } else assert.equal(detail.ledger, null)
        if (ordinal === 1 || ordinal === 9) {
          assert.equal(detail.paidAt, null)
          assert.equal(detail.settledAt, null)
          assert.equal(detail.transactionReference, null)
        }
        if (ordinal === 5) {
          assert.ok(detail.closureVerifiedAt)
          assert.equal(detail.closureReference, 'SYNTHETIC-CLOSURE-5')
        }
      }
      const day = await list({ from: '2026-10-01', to: '2026-10-01', limit: '100' })
      assert.equal(day.pagination.total, 7)
      assert.deepEqual(
        day.items.map((item) => item.id),
        [6, 9, 5, 4, 3, 2, 1].map(topupId)
      )
      assert.equal((await list({ from: '2026-10-02', to: '2026-10-02' })).pagination.total, 1)
      for (const search of ['%', '_', '\\'])
        assert.equal((await list({ search })).pagination.total, 9)
      assert.equal((await list({ search: "' OR 1=1 --" })).pagination.total, 0)
      const inactive = await list({ method: methodA, limit: '100' })
      assert.equal(inactive.pagination.total, 7)
      assert.ok(inactive.items.every((item) => item.method.id === methodA))
      assert.equal((await list({ status: 'FAILED' })).pagination.total, 1)
      assert.equal((await list({ status: 'CANCELLED' })).pagination.total, 1)
      assert.equal((await list({ status: 'PROCESSING' })).pagination.total, 1)
      assert.equal((await list({ status: 'PENDING' })).pagination.total, 2)
      assert.equal((await list({ status: 'SUCCESS' })).pagination.total, 4)
      const unused = await list({ method: unusedMethod })
      assert.equal(unused.pagination.total, 0)
      assert.deepEqual(unused.items, [])
      assert.ok(unused.options.methods.some((method) => method.id === unusedMethod))
      await assert.rejects(list({ method: '40000000-0000-0000-0000-000000000004' }), {
        status: 422,
      })
      const first = await list({ page: '1', limit: '1' })
      const second = await list({ page: '2', limit: '1' })
      assert.equal(first.items[0].id, topupId(7))
      assert.equal(second.items[0].id, topupId(6))
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  }
)

test.after(async () => {
  await pool.end()
})
