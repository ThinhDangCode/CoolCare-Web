import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import {
  WithdrawalsRepository,
  buildWithdrawalListQueries,
  WITHDRAWAL_DETAIL_SQL,
} from '../src/modules/withdrawals/withdrawals.repository.js'
import { validateWithdrawalListQuery } from '../src/modules/withdrawals/withdrawals.validation.js'

const enabled = process.env.RUN_WITHDRAWALS_DB_TESTS === '1'

test(
  'local withdrawal list/detail preserve all request statuses, null fees, bank strings and historical owned ledger without changing data',
  { skip: !enabled },
  async () => {
    const repository = new WithdrawalsRepository()
    const list = (query) => repository.listWithdrawals(validateWithdrawalListQuery(query))
    const tables = [
      'withdrawals',
      'technician_accounts',
      'settlement_transactions',
      'technician_topups',
      'payments',
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
      await pool.query(`SELECT w.*,u.full_name,u.phone,(w.initiated_at AT TIME ZONE INTERVAL '+07:00')::date::text AS vietnam_date
      FROM withdrawals w JOIN technician_profiles tp ON tp.id=w.technician_id JOIN users u ON u.id=tp.user_id ORDER BY w.initiated_at DESC,w.id DESC`)
    ).rows
    assert.ok(expected.length > 0, 'Needs existing local withdrawal fixtures')
    const all = await list({ limit: '100' })
    assert.equal(all.pagination.total, expected.length)
    assert.deepEqual(
      all.items.map((item) => item.id),
      expected.slice(0, 100).map((item) => item.id)
    )
    for (const fixture of expected.slice(0, 100)) {
      const item = all.items.find((item) => item.id === fixture.id)
      assert.equal(item.amount, fixture.amount)
      assert.equal(typeof item.amount, 'string')
      assert.equal(item.feeAmount, fixture.fee_amount)
      assert.equal(item.netAmount, fixture.net_amount)
      assert.equal(item.status, fixture.status)
      assert.equal(item.payoutReference, fixture.payout_reference)
      assert.deepEqual(item.technician, {
        id: fixture.technician_id,
        name: fixture.full_name,
        phone: fixture.phone,
      })
      const detail = await repository.getWithdrawal(fixture.id)
      assert.deepEqual(detail.bank, {
        name: fixture.bank_name,
        accountNumber: fixture.account_number,
        accountHolder: fixture.account_holder,
      })
      assert.equal(typeof detail.bank.accountNumber, 'string')
      assert.equal(detail.failureReason, fixture.failure_reason)
      assert.equal(detail.note, fixture.note)
      assert.equal(detail.initiatedAt.getTime(), fixture.initiated_at.getTime())
      assert.equal(detail.processedAt?.getTime(), fixture.processed_at?.getTime())
      assert.equal(detail.paidAt?.getTime(), fixture.paid_at?.getTime())
      const ledger =
        (
          await pool.query(
            `SELECT st.id,st.transaction_type AS type,st.amount,st.balance_before AS "balanceBefore",
        st.balance_after AS "balanceAfter",st.created_at AS "createdAt",st.reference_id AS "referenceId"
        FROM settlement_transactions st JOIN technician_accounts a ON a.id=st.technician_account_id
        WHERE st.withdrawal_id=$1 AND st.transaction_type='WITHDRAWAL' AND st.technician_account_id=$2 AND a.technician_id=$3`,
            [fixture.id, fixture.technician_account_id, fixture.technician_id]
          )
        ).rows[0] ?? null
      assert.deepEqual(detail.ledger, ledger)
      if (fixture.status === 'PENDING') {
        assert.equal(detail.feeAmount, null)
        assert.equal(detail.netAmount, null)
        assert.equal(detail.ledger, null)
      }
      assert.equal('idempotency_key' in detail, false)
      assert.equal('bank' in item, false)
      for (const search of [fixture.id, fixture.payout_reference, fixture.full_name, fixture.phone])
        if (search)
          assert.ok(
            (await list({ search, limit: '100' })).items.some((item) => item.id === fixture.id)
          )
      const sameDay = await list({
        from: fixture.vietnam_date,
        to: fixture.vietnam_date,
        status: fixture.status,
        limit: '100',
      })
      assert.deepEqual(
        sameDay.items.map((item) => item.id),
        expected
          .filter(
            (item) => item.vietnam_date === fixture.vietnam_date && item.status === fixture.status
          )
          .slice(0, 100)
          .map((item) => item.id)
      )
    }
    for (const status of ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'])
      assert.equal(
        (await list({ status })).pagination.total,
        expected.filter((item) => item.status === status).length
      )
    for (const search of ['%', '_', '\\', "' OR 1=1 --"]) {
      const matches = expected.filter((item) =>
        [item.id, item.payout_reference, item.full_name, item.phone].some((value) =>
          value?.toLowerCase().includes(search.toLowerCase())
        )
      )
      assert.deepEqual(
        (await list({ search, limit: '100' })).items.map((item) => item.id),
        matches.slice(0, 100).map((item) => item.id)
      )
    }
    const pages = []
    for (let page = 1; page <= Math.min(expected.length, 100); page++)
      pages.push((await list({ page: String(page), limit: '1' })).items[0].id)
    assert.deepEqual(
      pages,
      expected.slice(0, 100).map((item) => item.id)
    )
    const empty = await list({ search: 'No matching synthetic withdrawal 123456789' })
    assert.deepEqual(empty, {
      items: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    })
    assert.equal(await repository.getWithdrawal('00000000-0000-0000-0000-000000000000'), null)
    assert.deepEqual(await checksum(), before)
  }
)

const techA = '20000000-0000-0000-0000-000000000001'
const techB = '20000000-0000-0000-0000-000000000002'
const accountA = '30000000-0000-0000-0000-000000000001'
const accountB = '30000000-0000-0000-0000-000000000002'
const wid = (ordinal) => `10000000-0000-0000-0000-${String(ordinal).padStart(12, '0')}`
const fixtureSql = `WITH withdrawals AS (
  SELECT ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid AS id,
    '${techA}'::uuid AS technician_id,CASE WHEN i=3 THEN '${accountB}'::uuid ELSE '${accountA}'::uuid END AS technician_account_id,
    CASE WHEN i IN(2,3,4,8) THEN 'SYNTHETIC-PAYOUT-'||i::text ELSE NULL END AS payout_reference,
    100000.00::numeric AS amount,CASE WHEN i IN(2,3,4,8) THEN 5000.00::numeric ELSE NULL END AS fee_amount,
    CASE WHEN i IN(2,3,4,8) THEN 95000.00::numeric ELSE NULL END AS net_amount,
    CASE i WHEN 1 THEN 'PENDING' WHEN 5 THEN 'FAILED' WHEN 6 THEN 'CANCELLED' WHEN 7 THEN 'PROCESSING' ELSE 'SUCCESS' END AS status,
    CASE i WHEN 6 THEN '2026-10-01 23:59:59+07'::timestamptz WHEN 7 THEN '2026-10-02 00:00:00+07'::timestamptz
      WHEN 8 THEN '2026-09-30 23:59:59+07'::timestamptz ELSE '2026-10-01 00:00:00+07'::timestamptz END AS initiated_at,
    NULL::timestamptz AS processed_at,NULL::timestamptz AS paid_at,'Synthetic bank'::text AS bank_name,
    '000000001234'::text AS account_number,'SYNTHETIC HOLDER'::text AS account_holder,
    CASE WHEN i=5 THEN 'Synthetic provider rejected' ELSE NULL END AS failure_reason,NULL::text AS note
    FROM generate_series(1,8) i
  ), technician_profiles AS (SELECT '${techA}'::uuid AS id,'${techA}'::uuid AS user_id),
  users AS (SELECT '${techA}'::uuid AS id,'Synthetic%_\\ Person'::text AS full_name,'0900000000'::text AS phone),
  technician_accounts AS (SELECT * FROM (VALUES ('${accountA}'::uuid,'${techA}'::uuid,999999.00::numeric),
    ('${accountB}'::uuid,'${techB}'::uuid,999999.00::numeric)) AS a(id,technician_id,settlement_balance)),
  settlement_transactions AS (
    SELECT ('50000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid AS id,
      ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid AS withdrawal_id,
      CASE WHEN i IN(3,4) THEN '${accountB}'::uuid ELSE '${accountA}'::uuid END AS technician_account_id,
      CASE WHEN i=8 THEN 'TOP_UP' ELSE 'WITHDRAWAL' END AS transaction_type,
      -100000.00::numeric AS amount,200000.00::numeric AS balance_before,100000.00::numeric AS balance_after,
      '2026-10-01 00:00:01+07'::timestamptz AS created_at,NULL::text AS reference_id
    FROM (VALUES(2),(3),(4),(8)) AS fixture(i)
  ) `

test(
  'actual SELECT-only SQL checks UTC+7 boundaries, literal wildcards and ledger source/type/account/owner isolation',
  { skip: !enabled },
  async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN READ ONLY')
      for (const ordinal of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const result = (await client.query(`${fixtureSql}${WITHDRAWAL_DETAIL_SQL}`, [wid(ordinal)]))
          .rows[0]
        assert.equal(result.id, wid(ordinal))
        assert.equal(result.accountNumber, '000000001234')
        if (ordinal === 2) {
          assert.ok(result.ledgerId)
          assert.equal(result.ledgerAmount, '-100000.00')
          assert.equal(result.balanceBefore, '200000.00')
          assert.equal(result.balanceAfter, '100000.00')
          assert.notEqual(result.balanceAfter, '999999.00')
        } else assert.equal(result.ledgerId, null)
        if (ordinal === 1) {
          assert.equal(result.feeAmount, null)
          assert.equal(result.netAmount, null)
        }
        if (ordinal === 5) assert.equal(result.failureReason, 'Synthetic provider rejected')
      }
      const run = async (query) => {
        const filters = validateWithdrawalListQuery(query)
        const { countSql, rowsSql, values, rowValues } = buildWithdrawalListQueries(filters)
        return {
          total: (await client.query(`${fixtureSql}${countSql}`, values)).rows[0].total,
          rows: (await client.query(`${fixtureSql}${rowsSql}`, rowValues)).rows,
        }
      }
      const day = await run({ from: '2026-10-01', to: '2026-10-01', limit: '100' })
      assert.equal(day.total, 6)
      assert.deepEqual(
        day.rows.map((row) => row.id),
        [6, 5, 4, 3, 2, 1].map(wid)
      )
      assert.equal((await run({ from: '2026-10-02', to: '2026-10-02' })).total, 1)
      for (const search of ['%', '_', '\\']) assert.equal((await run({ search })).total, 8)
      assert.equal((await run({ search: "' OR 1=1 --" })).total, 0)
      assert.equal((await run({ status: 'FAILED' })).rows[0].status, 'FAILED')
      assert.equal((await run({ status: 'PROCESSING' })).rows[0].status, 'PROCESSING')
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  }
)

test.after(async () => {
  await pool.end()
})
