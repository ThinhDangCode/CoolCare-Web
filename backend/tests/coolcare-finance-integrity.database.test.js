import test, {after} from 'node:test'
import assert from 'node:assert/strict'
import {pool} from '../src/config/database.js'

// READ ONLY. Run against a separate test database if possible.
const enabled=process.env.RUN_COOLCARE_FINANCE_AUDIT==='1'
after(async()=>{if(enabled) await pool.end()})
async function none(label,sql) {
 const {rows}=await pool.query(sql)
 assert.deepEqual(rows,[],`${label}: inconsistent rows: ${JSON.stringify(rows.slice(0,10))}`)
}
test('F-DB01: no duplicate SUCCESS payment per booking',{skip:!enabled},async()=>{
 await none('duplicate payments',`SELECT booking_id,COUNT(*)::int AS count FROM payments
 WHERE UPPER(payment_status::text) IN ('2','SUCCESS')
 GROUP BY booking_id HAVING COUNT(*)>1 LIMIT 20`)
})
test('F-DB02: each SUCCESS withdrawal has at most one WITHDRAWAL ledger debit',{skip:!enabled},async()=>{
 await none('duplicate withdrawal ledger',`SELECT withdrawal_id,COUNT(*)::int AS count
 FROM settlement_transactions WHERE withdrawal_id IS NOT NULL
 AND UPPER(transaction_type::text) IN ('3','WITHDRAWAL')
 GROUP BY withdrawal_id HAVING COUNT(*)>1 LIMIT 20`)
})
test('F-DB03: SUCCESS withdrawal amounts match its posted debit',{skip:!enabled},async()=>{
 await none('withdrawal/ledger mismatch',`SELECT w.id, w.amount, st.amount AS posted
 FROM withdrawals w
 LEFT JOIN settlement_transactions st ON st.withdrawal_id=w.id
 AND UPPER(st.transaction_type::text) IN ('3','WITHDRAWAL')
 WHERE UPPER(w.status::text) IN ('2','SUCCESS')
 AND (st.id IS NULL OR st.amount<>-w.amount) LIMIT 20`)
})
test('F-DB04: ledger withdrawal always references an existing withdrawal',{skip:!enabled},async()=>{
 await none('orphan withdrawal ledger',`SELECT st.id FROM settlement_transactions st
 LEFT JOIN withdrawals w ON w.id=st.withdrawal_id
 WHERE st.withdrawal_id IS NOT NULL AND w.id IS NULL LIMIT 20`)
})
test('F-DB05: payment IDs and withdrawal IDs have no duplicate ledger posting',{skip:!enabled},async()=>{
 await none('duplicate payment ledger',`SELECT payment_id,transaction_type,COUNT(*)::int AS count
 FROM settlement_transactions WHERE payment_id IS NOT NULL
 GROUP BY payment_id,transaction_type HAVING COUNT(*)>1 LIMIT 20`)
})
