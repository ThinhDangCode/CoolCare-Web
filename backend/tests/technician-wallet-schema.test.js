import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const repo = readFileSync(new URL('../src/modules/technician-wallet/wallet.repository.js',import.meta.url),'utf8')
const app = readFileSync(new URL('../src/app.js',import.meta.url),'utf8')

test('wallet numeric status comparisons match supplied smallint schema',()=>{
  assert.match(repo,/tp.verification_status=1/)
  assert.match(repo,/u.status=0/)
  assert.match(repo,/payment_kind=0/)
  assert.match(repo,/payment_kind IN \(1,2\)/)
  assert.match(repo,/payment_status=2/)
  assert.match(repo,/transaction_type=2/)
  assert.match(repo,/CASE st.transaction_type WHEN 0/)
  assert.match(repo,/CASE t.payment_status WHEN 0/)
})
test('technician top-up writes only columns existing in supplied SQL schema',()=>{
  assert.match(repo,/INSERT INTO technician_topups\s*\(id,idempotency_key,topup_code,technician_id,technician_account_id,amount,payment_method_id,payment_status,created_at\)/)
  assert.doesNotMatch(repo,/UPDATE technician_topups SET[^`]*updated_at/)
  assert.match(repo,/payment_status=2,transaction_reference=\$2,\s*paid_at=CURRENT_TIMESTAMP WHERE id=\$1/)
})
test('public signed gateway callback routes precede authenticated wallet routes',()=>{
  const pub=app.indexOf("app.use('/api/technician-wallet/callbacks'")
  const secured=app.indexOf("app.use('/api/technician-wallet',")
  assert.ok(pub>0 && secured>pub)
})
test('wallet maintains signed ledger transactions and does not manually credit the account',()=>{
  assert.match(repo,/UPDATE technician_topups SET payment_status=2/)
  assert.doesNotMatch(repo,/UPDATE technician_accounts SET settlement_balance/)
  assert.doesNotMatch(repo,/INSERT INTO settlement_transactions/)
})
