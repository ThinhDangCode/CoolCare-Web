import assert from 'node:assert/strict'
import test from 'node:test'
import { ComplaintRepository } from '../src/modules/complaints/complaint.repository.js'

const userId = '12345678-1234-1234-1234-123456789012'
const complaintId = '23456789-2345-2345-2345-234567890123'
const bookingId = '34567890-3456-3456-3456-345678901234'

function stub(respond) {
  const calls=[]
  const audits=[]
  const repository = new ComplaintRepository({
    transaction: async work => work({query: async (sql,values) => {
      calls.push([sql,values])
      return respond(sql,values)
    }}),
    audit: event => audits.push(event),
  })
  return {repository,calls,audits}
}

test('ComplaintRepository.listMine scopes status, user and pagination', async () => {
  const {repository,calls} = stub(sql => sql.includes('count(*)')
    ? {rows:[{total:2}]} : {rows:[{id:complaintId}]})
  const result = await repository.listMine(userId,{status:'OPEN',page:2,limit:5})
  assert.deepEqual(result,{items:[{id:complaintId}],total:2,page:2,limit:5})
  assert.deepEqual(calls[0][1],[userId,'OPEN'])
  assert.deepEqual(calls[1][1],[userId,'OPEN',5,5])
})

test('ComplaintRepository.getMine returns a customer-owned complaint', async () => {
  const row = {id:complaintId}
  const {repository,calls} = stub(() => ({rows:[row]}))
  assert.equal(await repository.getMine(userId,complaintId),row)
  assert.deepEqual(calls[0][1],[complaintId,userId])
})

test('ComplaintRepository.getMine rejects another customer\'s complaint', async () => {
  const {repository} = stub(() => ({rows:[]}))
  await assert.rejects(repository.getMine(userId,complaintId),{status:404,code:'NOT_FOUND'})
})

test('ComplaintRepository.submit rejects a missing booking', async () => {
  const {repository} = stub(() => ({rows:[]}))
  await assert.rejects(repository.submit(userId,{booking_id:bookingId,type:'SERVICE',subject:'Issue',description:'Description'}),
    {status:404,code:'BOOKING_NOT_FOUND'})
})

test('ComplaintRepository.submit requires a technician for technician complaints', async () => {
  const {repository} = stub(() => ({rows:[{id:bookingId,customer_id:'customer-1',technician_id:null}]}))
  await assert.rejects(repository.submit(userId,{booking_id:bookingId,type:'TECHNICIAN',subject:'Issue',description:'Description'}),
    {status:422,code:'VALIDATION_ERROR'})
})

test('ComplaintRepository.submit rejects an already active complaint', async () => {
  const {repository} = stub(sql => sql.includes('FROM bookings')
    ? {rows:[{id:bookingId,customer_id:'customer-1',technician_id:'technician-1'}]}
    : {rows:[{id:complaintId}]})
  await assert.rejects(repository.submit(userId,{booking_id:bookingId,type:'SERVICE',subject:'Issue',description:'Description'}),
    {status:409,code:'ACTIVE_COMPLAINT_EXISTS'})
})

test('ComplaintRepository.submit creates a complaint when booking is eligible', async () => {
  const {repository,calls} = stub(sql => {
    if (sql.includes('FROM bookings')) return {rows:[{id:bookingId,customer_id:'customer-1',technician_id:null}]}
    if (sql.includes('FROM complaints WHERE booking_id')) return {rows:[]}
    if (sql.includes('INSERT INTO complaints')) return {rows:[{id:complaintId,status:'OPEN'}]}
    return {rows:[]}
  })
  const result = await repository.submit(userId,{booking_id:bookingId,type:'SERVICE',subject:'Issue',description:'Description'})
  assert.deepEqual(result,{id:complaintId,status:'OPEN',type:'SERVICE',subject:'Issue'})
  assert.equal(calls.find(([sql]) => sql.includes('INSERT INTO complaints'))[1][2],bookingId)
})

test('ComplaintRepository.list escapes search and applies status and type', async () => {
  const {repository,calls} = stub(sql => sql.includes('count(*)')
    ? {rows:[{total:1}]} : {rows:[{id:complaintId}]})
  const result = await repository.list({page:2,limit:5,search:'a_b%',status:'OPEN',type:'SERVICE',sortBy:'customer_name',sortOrder:'asc'})
  assert.equal(result.total,1)
  assert.deepEqual(calls[1][1],['%a\\_b\\%%','OPEN','SERVICE'])
  assert.match(calls[2][0],/LOWER\(cu.full_name\) ASC/)
  assert.deepEqual(calls[2][1],['%a\\_b\\%%','OPEN','SERVICE',5,5])
})

test('ComplaintRepository.get returns a full complaint or not found', async () => {
  const row = {id:complaintId,status:'OPEN'}
  const found = stub(() => ({rows:[row]}))
  assert.equal(await found.repository.get(complaintId),row)
  assert.deepEqual(found.calls[0][1],[complaintId])
  const missing = stub(() => ({rows:[]}))
  await assert.rejects(missing.repository.get(complaintId),{status:404,code:'NOT_FOUND'})
})

for (const [name,before,data,expected] of [
  ['missing',null,{status:'IN_PROGRESS',resolution:'In progress'},'NOT_FOUND'],
  ['closed',{id:complaintId,status:'CLOSED'},{status:'CLOSED',resolution:'Already closed'},'COMPLAINT_CLOSED'],
  ['invalid transition',{id:complaintId,status:'OPEN'},{status:'CLOSED',resolution:'Close immediately'},'INVALID_STATUS_TRANSITION'],
  ['invalid draft status',{id:complaintId,status:'OPEN'},{status:'IN_PROGRESS',resolution:'Draft text',is_draft:true},'INVALID_DRAFT_STATUS'],
]) {
  test(`ComplaintRepository.resolve rejects ${name}`, async () => {
    const {repository} = stub(() => ({rows:before?[before]:[]}))
    await assert.rejects(repository.resolve(complaintId,data,userId),{code:expected})
  })
}

test('ComplaintRepository.resolve records a valid status change and notification', async () => {
  const before = {id:complaintId,status:'OPEN',type:'SERVICE',technician_id:null}
  const after = {...before,status:'IN_PROGRESS',resolution:'Investigation underway'}
  const {repository,calls,audits} = stub(sql => {
    if (sql.includes('FROM complaints WHERE id=$1 FOR UPDATE')) return {rows:[before]}
    if (sql.includes('FROM technician_penalties')) return {rows:[]}
    if (sql.includes('UPDATE complaints SET')) return {rows:[after]}
    return {rows:[]}
  })
  assert.equal(await repository.resolve(complaintId,{status:'IN_PROGRESS',resolution:'Investigation underway',notify_customer:true},userId),after)
  assert.equal(calls.some(([sql]) => sql.includes('INSERT INTO notifications')),true)
  assert.equal(audits[0].action,'RESOLVE_COMPLAINT')
})

for (const [name,complaint,duplicate,expected] of [
  ['missing',null,false,'NOT_FOUND'],
  ['unresolved',{id:complaintId,status:'OPEN'},false,'COMPLAINT_NOT_RESOLVED'],
  ['already compensated',{id:complaintId,status:'RESOLVED',complaint_code:'CP-1',customer_id:'customer-1'},true,'COMPENSATION_ALREADY_GRANTED'],
]) {
  test(`ComplaintRepository.createCompensationVoucher rejects ${name}`, async () => {
    const {repository} = stub(sql => {
      if (sql.includes('FROM complaints c')) return {rows:complaint?[complaint]:[]}
      if (sql.includes('FROM vouchers WHERE name')) return {rows:duplicate?[{id:'voucher-1'}]:[],rowCount:duplicate?1:0}
      return {rows:[]}
    })
    await assert.rejects(repository.createCompensationVoucher(complaintId,{discount_value:10000,minimum_order_amount:50000,valid_days:30},userId),
      {code:expected})
  })
}

test('ComplaintRepository.createCompensationVoucher creates one voucher and audit entry', async () => {
  const complaint = {id:complaintId,status:'RESOLVED',complaint_code:'CP-1',customer_id:'customer-1',user_id:userId}
  const created = {id:'voucher-1',discount_type:'FIXED_AMOUNT',discount_value:10000,end_at:'2099-01-01'}
  const {repository,calls,audits} = stub(sql => {
    if (sql.includes('FROM complaints c')) return {rows:[complaint]}
    if (sql.includes('FROM vouchers WHERE name')) return {rows:[],rowCount:0}
    if (sql.includes('INSERT INTO vouchers')) return {rows:[created]}
    return {rows:[]}
  })
  assert.equal(await repository.createCompensationVoucher(complaintId,{discount_value:10000,minimum_order_amount:50000,valid_days:30,notify_customer:true},userId),created)
  assert.equal(calls.some(([sql]) => sql.includes('INSERT INTO notifications')),true)
  assert.equal(audits[0].action,'GIFT_COMPLAINT_VOUCHER')
})
