// SELECT-only synthetic fixtures. No schema, seed, financial or identity rows are written.
import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { adaptDatabaseQuery } from '../src/config/database-codebook-adapter.js'
import { SettlementsRepository } from '../src/modules/settlements/settlements.repository.js'
import { validateSettlementListQuery } from '../src/modules/settlements/settlements.validation.js'
const enabled = process.env.RUN_SETTLEMENTS_DB_TESTS === '1'
// Real revised-schema FIFO view expression, evaluated over synthetic CTE rows.
const view = `WITH exposure AS (
    SELECT s.*, CASE WHEN s.finalized_at IS NULL THEN 0::numeric ELSE
        GREATEST(0::numeric, -s.closing_balance - COALESCE((
            SELECT SUM(t.amount) FROM settlement_transactions t
            WHERE t.technician_account_id = s.technician_account_id
              AND t.created_at >= s.period_end AND t.amount > 0
        ),0)) END AS cumulative_remaining
    FROM settlements s WHERE s.finalized_at IS NOT NULL
), debts AS (
    SELECT e.*, GREATEST(0::numeric, cumulative_remaining - COALESCE(
        LAG(cumulative_remaining) OVER (PARTITION BY technician_account_id ORDER BY period_end),0)) AS debt_remaining_amount
    FROM exposure e
)
SELECT id AS settlement_id, technician_id, technician_account_id, period_start, period_end,
       closing_balance, debt_amount, debt_remaining_amount, due_at,
       CASE WHEN debt_remaining_amount = 0 THEN 2
            WHEN due_at <= CURRENT_TIMESTAMP THEN 3 ELSE 1 END::smallint AS effective_status
FROM debts
UNION ALL
SELECT id, technician_id, technician_account_id, period_start, period_end,
       closing_balance, debt_amount, 0::numeric, due_at, 0::smallint
FROM settlements WHERE finalized_at IS NULL`
const id = (group, n) => `${group}0000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const lit = v => v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`
function cte(name, types, records) {
  const cols = Object.keys(types)
  return `${name} AS (${records.length ? `SELECT * FROM (VALUES ${records.map(r => `(${cols.map(c => `${lit(r[c])}::${types[c]}`).join(',')})`).join(',')}) AS fixture(${cols.join(',')})` : `SELECT ${cols.map(c => `NULL::${types[c]} AS ${c}`).join(',')} WHERE false`})`
}
const at = (week, day=1) => `2026-10-${String(5+week*7+day).padStart(2,'0')}T10:00:00+07`
const settlements = []
const addPeriod = (n, account, week, totals={}) => {
  settlements.push({id:id(1,n),settlement_code:`EDGE-SET-${n}`,technician_id:id(2,account),technician_account_id:id(3,account),
    period_start:`2026-10-${String(5+week*7).padStart(2,'0')}T00:00:00+07`,period_end:`2026-10-${String(12+week*7).padStart(2,'0')}T00:00:00+07`,
    opening_balance:0,total_cash_settlement:0,total_online_earning:0,total_topup:0,total_withdrawal:0,total_adjustment:0,
    closing_balance:0,debt_amount:0,finalized_at:'2026-10-20T00:00:00+07',status:1,due_at:'2001-01-01T00:00:00Z',...totals})
}
addPeriod(1,1,0,{total_cash_settlement:-100,closing_balance:-100,debt_amount:100})
addPeriod(2,1,1,{opening_balance:-100,total_cash_settlement:-50,closing_balance:-150,debt_amount:50})
addPeriod(3,1,2,{opening_balance:99999,total_topup:99999,closing_balance:99999,debt_amount:99999,finalized_at:null,status:0})
for (let account=2;account<=17;account++) addPeriod(account+2,account,1)
Object.assign(settlements.find(s=>s.id===id(1,4)),{total_online_earning:200,closing_balance:200})
Object.assign(settlements.find(s=>s.id===id(1,5)),{total_online_earning:.03,closing_balance:.03})
Object.assign(settlements.find(s=>s.id===id(1,7)),{total_online_earning:9.99,closing_balance:9.99})
Object.assign(settlements.find(s=>s.id===id(1,9)),{total_cash_settlement:5,closing_balance:5})
Object.assign(settlements.find(s=>s.id===id(1,13)),{total_adjustment:-7,closing_balance:-7,debt_amount:7})
// Deliberately inconsistent identity must not enter list or detail.
addPeriod(20,2,1,{technician_account_id:id(3,1)})
const users = Array.from({length:17},(_,i)=>({id:id(4,i+1),full_name:`Synthetic%_\\ Technician ${i+1}`,phone:`090${String(i+1).padStart(7,'0')}`,avatar_url:i===0?'javascript:alert(1)':'https://example.com/avatar.png'}))
const profiles=users.map((u,i)=>({id:id(2,i+1),user_id:u.id}))
const accounts=profiles.map((p,i)=>({id:id(3,i+1),technician_id:p.id}))
const ledger=[];const payments=[];const members=[];let tx=0;let pay=0
function payment(account, overrides={}) {
  const row={id:id(6,++pay),payment_code:`EDGE-PAY-${pay}`,technician_id:id(2,account),payment_kind:1,payment_status:2,
    amount:12,commission_rate:.1,commission_base_amount:20,commission_amount:2,platform_discount_amount:0,technician_earning:10,
    paid_at:'2000-01-01T00:00:00Z',settled_at:'2026-10-14T10:00:00+07',...overrides}
  payments.push(row);return row
}
function movement(account,week,type,amount,p=null,options={}) {
  const row={id:id(5,++tx),technician_account_id:id(3,account),payment_id:p?.id??null,topup_id:null,withdrawal_id:null,
    transaction_type:type,amount,balance_before:0,balance_after:amount,description:`Synthetic movement ${tx}`,created_at:at(week),...options}
  ledger.push(row)
  const period=settlements.find(s=>s.technician_id===id(2,account)&&s.period_start.startsWith(`2026-10-${String(5+week*7).padStart(2,'0')}`))
  if(period?.finalized_at && options.attach!==false) members.push({id:id(7,tx),settlement_id:period.id,settlement_transaction_id:row.id})
  return row
}
movement(1,0,0,-100,payment(1,{payment_kind:0,amount:900,commission_base_amount:1000,commission_amount:100,technician_earning:800}))
movement(1,1,0,-50,payment(1,{payment_kind:0,amount:450,commission_base_amount:500,commission_amount:50,technician_earning:400}))
movement(1,2,2,120,null,{topup_id:id(8,1),created_at:'2026-10-20T00:00:00+07'})
movement(2,1,1,200,payment(2,{amount:250,commission_base_amount:500,commission_amount:50,technician_earning:200}))
movement(3,1,1,.01,payment(3,{amount:.02,commission_base_amount:.1,commission_amount:.01,technician_earning:.01}))
movement(3,1,1,.02,payment(3,{amount:.04,commission_base_amount:.2,commission_amount:.02,technician_earning:.02}))
const invalids=[
  {technician_id:id(2,2)}, {payment_status:1}, {settled_at:null}, {commission_amount:null},
  {commission_amount:-1}, {commission_rate:1.01}, {technician_earning:null}, {payment_kind:0},
  {technician_earning:9}, {amount:0,platform_discount_amount:12},
]
for(const change of invalids)movement(4,1,1,10,payment(4,change))
movement(4,1,1,10,null,{payment_id:id(6,999)})
movement(4,1,1,11,payment(4)) // wrong ledger delta
movement(4,1,2,10,payment(4)) // wrong ledger kind even though it links payment
const duplicate=payment(4)
movement(4,1,1,10,duplicate)
movement(4,1,1,10,duplicate)
movement(5,1,1,9.99,payment(5,{payment_kind:2,amount:0,commission_base_amount:.1,commission_amount:.01,platform_discount_amount:10,technician_earning:9.99}))
movement(6,1,0,0,payment(6,{payment_kind:0,amount:100,commission_base_amount:100,commission_amount:10,platform_discount_amount:10,technician_earning:100}))
movement(7,1,0,5,payment(7,{payment_kind:0,amount:100,commission_base_amount:100,commission_amount:10,platform_discount_amount:15,technician_earning:105}))
const zeroOnline=movement(8,1,1,0,payment(8,{amount:1,commission_base_amount:10,commission_amount:1,technician_earning:0}))
// Foreign account and both exact time boundaries must not enter period details.
members.push({id:id(7,900),settlement_id:id(1,11),settlement_transaction_id:zeroOnline.id})
const before=movement(9,1,1,10,payment(9),{created_at:'2026-10-11T23:59:59.999999+07'})
const after=movement(9,1,1,10,payment(9),{created_at:'2026-10-19T00:00:00+07'})
movement(10,1,1,10,payment(10),{attach:false})
movement(11,1,4,-7)
movement(12,1,2,10,null,{topup_id:id(8,2)})
movement(12,1,3,-5,null,{withdrawal_id:id(9,1)})
const types={
  settlements:{id:'uuid',settlement_code:'text',technician_id:'uuid',technician_account_id:'uuid',period_start:'timestamptz',period_end:'timestamptz',opening_balance:'numeric(14,2)',total_cash_settlement:'numeric(14,2)',total_online_earning:'numeric(14,2)',total_topup:'numeric(14,2)',total_withdrawal:'numeric(14,2)',total_adjustment:'numeric(14,2)',closing_balance:'numeric(14,2)',debt_amount:'numeric(14,2)',finalized_at:'timestamptz',status:'smallint',due_at:'timestamptz'},
  users:{id:'uuid',full_name:'text',phone:'text',avatar_url:'text'},technician_profiles:{id:'uuid',user_id:'uuid'},technician_accounts:{id:'uuid',technician_id:'uuid'},
  settlement_transactions:{id:'uuid',technician_account_id:'uuid',payment_id:'uuid',topup_id:'uuid',withdrawal_id:'uuid',transaction_type:'smallint',amount:'numeric(14,2)',balance_before:'numeric(14,2)',balance_after:'numeric(14,2)',description:'text',created_at:'timestamptz'},
  payments:{id:'uuid',payment_code:'text',technician_id:'uuid',payment_kind:'smallint',payment_status:'smallint',amount:'numeric(14,2)',commission_rate:'numeric',commission_base_amount:'numeric(14,2)',commission_amount:'numeric(14,2)',platform_discount_amount:'numeric(14,2)',technician_earning:'numeric(14,2)',paid_at:'timestamptz',settled_at:'timestamptz'},
  settlement_items:{id:'uuid',settlement_id:'uuid',settlement_transaction_id:'uuid'},
  technician_topups:{id:'uuid',topup_code:'text',technician_id:'uuid',technician_account_id:'uuid'},withdrawals:{id:'uuid',technician_id:'uuid',technician_account_id:'uuid'},
}
const records={settlements,users,technician_profiles:profiles,technician_accounts:accounts,settlement_transactions:ledger,payments,settlement_items:members,
  technician_topups:[{id:id(8,1),topup_code:'EDGE-TOPUP-1',technician_id:id(2,1),technician_account_id:id(3,1)},{id:id(8,2),topup_code:'EDGE-TOPUP-2',technician_id:id(2,12),technician_account_id:id(3,12)}],
  withdrawals:[{id:id(9,1),technician_id:id(2,12),technician_account_id:id(3,12)}]}
const fixture = `WITH ${Object.entries(types).map(([name,columns])=>cte(name,columns,records[name])).join(',\n')},settlement_debt_balances AS (${view}) `
test('SELECT-only settlement SQL preserves live FIFO debt, frozen history, boundaries and exact payment evidence', { skip: !enabled }, async () => {
const client = await pool.connect()
const executed=[]
try {
await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
const repository=new SettlementsRepository({transaction:async work=>work({query:async(sql,params=[])=>{
  executed.push(sql)
  if(sql.startsWith('SET TRANSACTION')) return {rows:[]}
  assert.match(sql,/^SELECT\b/,'Production statement must be SELECT only')
  const adapted=adaptDatabaseQuery(`${fixture}${sql}`,params)
  return client.query(adapted.query,adapted.params)
}})})
const list=query=>repository.listSettlements(validateSettlementListQuery(query??{}))
  const all=await list({limit:'50'})
  assert.equal(all.pagination.total,19)
  assert.equal(all.items.length,19)
  assert.equal(new Set(all.items.map(s=>s.id)).size,19)
  assert.deepEqual({...all.summary,remainingDebt:undefined},{totalPeriods:19,openPeriods:1,owingPeriods:2,settledPeriods:16,remainingDebt:undefined})
  assert.equal(all.summary.remainingDebt,'37.00')
  const first=await list({page:'1'}),second=await list({page:'2'})
  assert.equal(first.items.length,10);assert.equal(second.items.length,9)
  assert.deepEqual(first.summary,second.summary)
  assert.equal(new Set([...first.items,...second.items].map(s=>s.id)).size,19)
  assert.equal((await list({status:'SETTLED'})).pagination.total,16)
  assert.equal((await list({status:'OVERDUE'})).pagination.total,2)
  const onlyOpen=await list({status:'OPEN'})
  assert.equal(onlyOpen.pagination.total,1);assert.equal(onlyOpen.summary.remainingDebt,null)
  assert.ok(Object.values(onlyOpen.items[0].totals).every(v=>v===null))
  assert.equal((await list({from:'2026-10-12',to:'2026-10-12',limit:'50'})).pagination.total,17)
  assert.equal((await list({from:'2026-10-05',to:'2026-10-05'})).pagination.total,1)
  for(const search of ['%','_','\\']) assert.equal((await list({search})).pagination.total,19)
  assert.equal((await list({search:"' OR 1=1 --"})).pagination.total,0)
  assert.equal((await list({search:id(2,1)})).pagination.total,3)
  assert.equal((await list({search:'EDGE-SET-20'})).pagination.total,0)
  const noMatch=await list({search:'no such technician'});assert.equal(noMatch.summary.remainingDebt,'0.00')
  const period=n=>repository.getSettlement(id(1,n),{page:1,limit:50})
  const old=await period(1)
  assert.equal(old.status,'SETTLED');assert.equal(old.totals.closingBalance,'-100.00');assert.equal(old.totals.debtRemainingAmount,'0.00')
  assert.equal(old.technician.avatarUrl,null)
  assert.deepEqual(old.income,{technicianEarning:'800.00',commissionAmount:'100.00',matchedPayments:1,unavailablePaymentCount:0})
  const owing=await period(2)
  assert.equal(owing.status,'OVERDUE');assert.equal(owing.totals.debtRemainingAmount,'30.00')
  const open=await period(3)
  assert.ok(Object.values(open.totals).every(v=>v===null));assert.ok(Object.values(open.income).every(v=>v===null))
  assert.equal(open.transactions.pagination.total,1);assert.equal(open.transactions.items[0].type,'TOP_UP')
  assert.equal(open.transactions.items[0].source.code,'EDGE-TOPUP-1')
  assert.deepEqual((await period(4)).income,{technicianEarning:'200.00',commissionAmount:'50.00',matchedPayments:1,unavailablePaymentCount:0})
  assert.deepEqual((await period(5)).income,{technicianEarning:'0.03',commissionAmount:'0.03',matchedPayments:2,unavailablePaymentCount:0})
  const bad=await period(6)
  assert.equal(bad.income.technicianEarning,null);assert.equal(bad.income.commissionAmount,null)
  assert.equal(bad.income.matchedPayments,1);assert.equal(bad.income.unavailablePaymentCount,13)
  assert.equal(bad.transactions.pagination.total,15)
  assert.deepEqual((await period(7)).income,{technicianEarning:'9.99',commissionAmount:'0.01',matchedPayments:1,unavailablePaymentCount:0})
  assert.deepEqual((await period(8)).income,{technicianEarning:'100.00',commissionAmount:'10.00',matchedPayments:1,unavailablePaymentCount:0})
  assert.deepEqual((await period(9)).income,{technicianEarning:'105.00',commissionAmount:'10.00',matchedPayments:1,unavailablePaymentCount:0})
  assert.deepEqual((await period(10)).income,{technicianEarning:'0.00',commissionAmount:'1.00',matchedPayments:1,unavailablePaymentCount:0})
  for(const n of [11,12]) {
    const missingMembership=await period(n)
    assert.equal(missingMembership.transactions.pagination.total,0)
    assert.deepEqual(missingMembership.income,{technicianEarning:'0.00',commissionAmount:'0.00',matchedPayments:0,unavailablePaymentCount:0})
  }
  const adjust=await period(13)
  assert.equal(adjust.status,'OVERDUE');assert.equal(adjust.totals.adjustment,'-7.00')
  assert.deepEqual(adjust.income,{technicianEarning:'0.00',commissionAmount:'0.00',matchedPayments:0,unavailablePaymentCount:0})
  const funding=await period(14)
  assert.deepEqual(funding.transactions.items.map(t=>t.type).sort(),['TOP_UP','WITHDRAWAL'])
  assert.equal(await period(20),null);assert.equal(await period(999),null)
  const txFirst=await repository.getSettlement(id(1,6),{page:1,limit:10})
  const txSecond=await repository.getSettlement(id(1,6),{page:2,limit:10})
  assert.equal(txFirst.transactions.items.length,10);assert.equal(txSecond.transactions.items.length,5)
  assert.equal(new Set([...txFirst.transactions.items,...txSecond.transactions.items].map(t=>t.id)).size,15)
  assert.deepEqual(txFirst.income,txSecond.income)
  assert.ok(executed.length > 100)
} finally {
  await client.query('ROLLBACK')
  client.release()
}
})

test.after(async () => { await pool.end() })
