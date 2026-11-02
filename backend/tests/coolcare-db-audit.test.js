import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../src/config/database.js'

// Chỉ SELECT; không sửa dữ liệu. Bật RUN_COOLCARE_DB_AUDIT=1 khi đã kết nối DB test.
const enabled=process.env.RUN_COOLCARE_DB_AUDIT === '1'

test('DB01 không có payment SUCCESS trùng trên cùng booking', {skip:!enabled}, async () => {
  const {rows}=await pool.query(`SELECT booking_id, count(*)::int AS n FROM payments WHERE payment_status='SUCCESS' GROUP BY booking_id HAVING count(*)>1 LIMIT 10`)
  assert.deepEqual(rows,[],`Booking có payment SUCCESS trùng: ${JSON.stringify(rows)}`)
})
test('DB02 không có withdrawal SUCCESS bị ghi ledger trùng', {skip:!enabled}, async () => {
  const {rows}=await pool.query(`SELECT withdrawal_id,count(*)::int AS n FROM settlement_transactions WHERE withdrawal_id IS NOT NULL GROUP BY withdrawal_id HAVING count(*)>1 LIMIT 10`)
  assert.deepEqual(rows,[],`Withdrawal có ledger trùng: ${JSON.stringify(rows)}`)
})
test('DB03 không có topup bị ghi ledger trùng', {skip:!enabled}, async () => {
  const {rows}=await pool.query(`SELECT topup_id,count(*)::int AS n FROM settlement_transactions WHERE topup_id IS NOT NULL GROUP BY topup_id HAVING count(*)>1 LIMIT 10`)
  assert.deepEqual(rows,[],`Topup có ledger trùng: ${JSON.stringify(rows)}`)
})
test('DB04 không có idempotency key rút tiền trùng', {skip:!enabled}, async () => {
  const {rows}=await pool.query(`SELECT idempotency_key,count(*)::int AS n FROM withdrawals WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING count(*)>1 LIMIT 10`)
  assert.deepEqual(rows,[],`Withdrawal key trùng: ${JSON.stringify(rows)}`)
})
