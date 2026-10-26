import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const repo = readFileSync(new URL('../src/modules/technician-wallet/wallet.repository.js',import.meta.url),'utf8')
const app = readFileSync(new URL('../src/app.js',import.meta.url),'utf8')

test('wallet status comparisons accept revised smallint codebooks',()=>{
  assert.match(repo,/UPPER\(tp\.verification_status::text\) IN \('1', 'VERIFIED'\)/)
  assert.match(repo,/UPPER\(u\.status::text\) IN \('0', 'ACTIVE'\)/)
  assert.match(repo,/UPPER\(payment_kind::text\) IN \('0', 'CASH'\)/)
  assert.match(repo,/'1', '2', 'VNPAY', 'ZALOPAY'/)
  assert.match(repo,/UPPER\(payment_status::text\) IN \('2', 'SUCCESS'\)/)
  assert.match(repo,/UPPER\(transaction_type::text\) IN \('2', 'TOP_UP'\)/)
  assert.match(repo,/CASE UPPER\(st\.transaction_type::text\)\s+WHEN '0'/)
  assert.match(repo,/CASE UPPER\(t\.payment_status::text\)\s+WHEN '0'/)
})
test('technician top-up writes only columns existing in supplied SQL schema',()=>{
  assert.match(repo,/INSERT INTO technician_topups\s*\(\s*id,\s*idempotency_key,\s*topup_code,\s*technician_id,\s*technician_account_id,\s*amount,\s*payment_method_id,\s*payment_status,\s*created_at\s*\)/)
  assert.doesNotMatch(repo,/UPDATE technician_topups\s+SET[^`]*updated_at/)
  assert.match(repo,/payment_status = 2,\s*transaction_reference = \$2,\s*paid_at = CURRENT_TIMESTAMP\s+WHERE id = \$1/)
})
test('public signed gateway callback routes precede authenticated wallet routes',()=>{
  const pub=app.indexOf("app.use('/api/technician-wallet/callbacks'")
  const secured=app.indexOf("app.use('/api/technician-wallet',")
  assert.ok(pub>0 && secured>pub)
})
test('wallet maintains signed ledger transactions and does not manually credit the account',()=>{
  assert.match(repo,/UPDATE technician_topups\s+SET\s+payment_status = 2/)
  assert.doesNotMatch(repo,/UPDATE technician_accounts SET settlement_balance/)
  assert.doesNotMatch(repo,/INSERT INTO settlement_transactions/)
})
