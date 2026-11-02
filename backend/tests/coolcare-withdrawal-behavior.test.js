import test from 'node:test'
import assert from 'node:assert/strict'
import { TechnicianWalletRepository } from '../src/modules/technician-wallet/wallet.repository.js'

// Deterministic transaction double: models a serialized wallet row lock.
// This checks repository behavior; it DOES NOT replace PostgreSQL concurrency tests.
function walletHarness(startBalance = 300000) {
  const rows = new Map()
  let balance = startBalance
  let tail = Promise.resolve()
  let inserts = 0
  const account = { technician_id: 'tech-1', account_id: 'account-1' }
  const transaction = async (work) => {
    const previous = tail
    let release
    tail = new Promise(resolve => { release = resolve })
    await previous
    const oldRows = new Map([...rows].map(([k,v]) => [k, {...v}]))
    const oldBalance = balance
    const oldInserts = inserts
    const db = { query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.startsWith('SELECT id FROM technician_accounts')) return { rows: [{id: account.account_id}] }
      if (s.startsWith('SELECT * FROM withdrawals WHERE idempotency_key')) return { rows: rows.has(params[0]) ? [rows.get(params[0])] : [] }
      if (s.startsWith('SELECT available_balance')) return { rows: [{available_balance: balance}] }
      if (s.startsWith('INSERT INTO withdrawals')) {
        const [id, key, techId, accountId, amount, bankName, accountNumber, accountHolder] = params
        assert.equal(techId, account.technician_id)
        assert.equal(accountId, account.account_id)
        rows.set(key, {id, technician_id: techId, amount, bank_name: bankName, account_number: accountNumber, account_holder: accountHolder, net_amount: amount, status: 0, payout_reference: null, paid_at:null})
        inserts++
        return {rows: []}
      }
      if (s.startsWith('UPDATE withdrawals SET status = 1')) return {rows: []}
      if (s.startsWith('UPDATE withdrawals SET status = 2')) {
        const [id, reference] = params
        const row = [...rows.values()].find(x => x.id === id)
        assert.ok(row)
        balance -= Number(row.amount)
        Object.assign(row, {status: 2, net_amount: row.amount, payout_reference: reference, paid_at: new Date()})
        return {rows: [row]}
      }
      throw new Error('Unrecognized query: ' + s.slice(0, 100))
    }}
    try { return await work(db) }
    catch (error) { rows.clear(); for (const [k,v] of oldRows) rows.set(k,v); balance=oldBalance; inserts=oldInserts; throw error }
    finally { release() }
  }
  const repository = new TechnicianWalletRepository({transaction})
  repository.owner = async () => account
  return {repository, state: () => ({balance, inserts, rows: [...rows.values()]})}
}
const request = (key, amount=100000) => ({key, amount, bankName:'ZALOPAY',accountNumber:'0900000000',accountHolder:'TEST TECHNICIAN'})
const KEY1 = '00000000-0000-4000-8000-000000000001'
const KEY2 = '00000000-0000-4000-8000-000000000002'
const KEY3 = '00000000-0000-4000-8000-000000000003'

test('W-I01: withdrawal SUCCESS deducts balance exactly once (simulated transaction)', async () => {
 const h=walletHarness(); const result=await h.repository.createMockWithdrawal('u', request(KEY1))
 assert.equal(result.status,'SUCCESS'); assert.equal(result.simulated,true)
 assert.equal(h.state().balance,200000); assert.equal(h.state().inserts,1)
})
test('W-I02: retry after lost response with same key returns same withdrawal, no second debit', async () => {
 const h=walletHarness(); const first=await h.repository.createMockWithdrawal('u',request(KEY1))
 const second=await h.repository.createMockWithdrawal('u',request(KEY1))
 assert.equal(second.id,first.id); assert.equal(h.state().inserts,1); assert.equal(h.state().balance,200000)
})
test('W-I03: reused key with changed amount is rejected and does not debit', async () => {
 const h=walletHarness(); await h.repository.createMockWithdrawal('u',request(KEY1))
 await assert.rejects(h.repository.createMockWithdrawal('u',request(KEY1,200000)), err=>err.code==='IDEMPOTENCY_CONFLICT' || err.message.includes('key'))
 assert.equal(h.state().balance,200000); assert.equal(h.state().inserts,1)
})
test('W-I04: insufficient funds rejects without inserting withdrawal', async () => {
 const h=walletHarness(50000)
 await assert.rejects(h.repository.createMockWithdrawal('u',request(KEY1)), err=>err.code==='INSUFFICIENT_BALANCE' || err.message.includes('balance'))
 assert.equal(h.state().balance,50000); assert.equal(h.state().inserts,0)
})
test('W-I05: concurrent submissions same key yield one debit (serialized test double)', async () => {
 const h=walletHarness(200000)
 const [a,b]=await Promise.all([h.repository.createMockWithdrawal('u',request(KEY1)),h.repository.createMockWithdrawal('u',request(KEY1))])
 assert.equal(a.id,b.id); assert.equal(h.state().inserts,1); assert.equal(h.state().balance,100000)
})
test('W-I06: concurrent separate keys cannot overdraw a simulated account', async () => {
 const h=walletHarness(150000)
 const results=await Promise.allSettled([h.repository.createMockWithdrawal('u',request(KEY2)),h.repository.createMockWithdrawal('u',request(KEY3))])
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1)
 assert.equal(results.filter(x=>x.status==='rejected').length,1)
 assert.equal(h.state().balance,50000); assert.equal(h.state().inserts,1)
})
