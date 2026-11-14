import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { AddressRepository } from '../src/modules/address/address.repository.js'

const repository = new AddressRepository()
const addressId = '12345678-1234-1234-1234-123456789012'
const customerId = '23456789-2345-2345-2345-234567890123'
const input = {
  recipientName:'An',phone:'0901234567',addressLine:'1 Main Street',ward:'Ninh Kiều',city:'Cần Thơ',
  latitude:10.0,longitude:105.8,isDefault:false,
}

function fakeTransaction(t, responder) {
  const calls = []
  let releases = 0
  t.mock.method(pool,'connect', async () => ({
    query: async (sql,params) => {
      calls.push([sql,params])
      if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {rows:[]}
      return responder(sql,params)
    },
    release: () => {releases++},
  }))
  return {calls,releases:() => releases}
}

test('AddressRepository.findCustomerProfileByUserId returns a profile or null', async () => {
  const queryable = {query: async (sql,params) => {
    assert.match(sql,/FROM customer_profiles/)
    assert.deepEqual(params,['user-1'])
    return {rows:[{id:customerId}]}
  }}
  assert.deepEqual(await repository.findCustomerProfileByUserId('user-1',queryable),{id:customerId})
  queryable.query = async () => ({rows:[]})
  assert.equal(await repository.findCustomerProfileByUserId('user-1',queryable),null)
})

test('AddressRepository.findAllByCustomerId and findById scope queries to the customer', async () => {
  const calls=[]
  const queryable = {query: async (sql,params) => {calls.push([sql,params]); return {rows:[{id:addressId}]}}}
  assert.deepEqual(await repository.findAllByCustomerId(customerId,queryable),[{id:addressId}])
  assert.deepEqual(await repository.findById(addressId,customerId,queryable),{id:addressId})
  assert.deepEqual(calls.map(call => call[1]),[[customerId],[addressId,customerId]])
  queryable.query = async () => ({rows:[]})
  assert.equal(await repository.findById(addressId,customerId,queryable),null)
})

test('AddressRepository.getProvinces maps a successful API response', async t => {
  t.mock.method(globalThis,'fetch',async (url,options) => {
    assert.match(url,/\/p\/$/)
    assert.equal(options.headers.Accept,'application/json')
    return {ok:true,json:async () => [{code:'CT',name:'Cần Thơ',extra:'ignored'}]}
  })
  assert.deepEqual(await repository.getProvinces(),[{code:'CT',name:'Cần Thơ'}])
})

test('AddressRepository.getProvinces rejects an API error', async t => {
  t.mock.method(globalThis,'fetch',async () => ({ok:false}))
  await assert.rejects(repository.getProvinces(),/Unable to load provinces/)
})

test('AddressRepository.getWards encodes province and maps the response', async t => {
  t.mock.method(globalThis,'fetch',async (url) => {
    assert.match(url,/province=CT%20one/)
    return {ok:true,status:200,json:async () => [{code:'W1',name:'Ninh Kiều',province_code:'CT',extra:'ignored'}]}
  })
  assert.deepEqual(await repository.getWards('CT one'),[{code:'W1',name:'Ninh Kiều',province_code:'CT'}])
})

test('AddressRepository.getWards distinguishes missing and failed API results', async t => {
  const fetchMock = t.mock.method(globalThis,'fetch',async () => ({ok:false,status:404}))
  assert.equal(await repository.getWards('CT'),null)
  fetchMock.mock.mockImplementation(async () => ({ok:false,status:500}))
  await assert.rejects(repository.getWards('CT'),/Unable to load wards/)
})

test('AddressRepository.create makes the first address default', async t => {
  const row = {id:addressId,is_default:true}
  const tx = fakeTransaction(t,async sql => {
    if (sql.includes('COUNT(*)')) return {rows:[{count:0}]}
    if (sql.includes('INSERT INTO customer_addresses')) return {rows:[row]}
    return {rows:[]}
  })
  assert.equal(await repository.create(customerId,input),row)
  const insert = tx.calls.find(([sql]) => sql.includes('INSERT INTO customer_addresses'))
  assert.equal(insert[1][9],true)
  assert.deepEqual(tx.calls.filter(([sql]) => ['BEGIN','COMMIT'].includes(sql)).map(([sql]) => sql),['BEGIN','COMMIT'])
  assert.equal(tx.releases(),1)
})

test('AddressRepository.create preserves a nondefault additional address', async t => {
  const tx = fakeTransaction(t,async sql => {
    if (sql.includes('COUNT(*)')) return {rows:[{count:1}]}
    if (sql.includes('INSERT INTO customer_addresses')) return {rows:[{id:addressId}]}
    return {rows:[]}
  })
  await repository.create(customerId,input)
  assert.equal(tx.calls.filter(([sql]) => sql.includes('UPDATE customer_addresses')).length,0)
  assert.equal(tx.calls.find(([sql]) => sql.includes('INSERT INTO customer_addresses'))[1][9],false)
})

test('AddressRepository.update returns null when the address does not belong to the customer', async t => {
  const tx = fakeTransaction(t,async () => ({rows:[]}))
  assert.equal(await repository.update(addressId,customerId,input),null)
  assert.equal(tx.calls.some(([sql]) => sql.includes('UPDATE customer_addresses')),false)
})

test('AddressRepository.update sets a new default and returns the updated row', async t => {
  const row = {id:addressId,is_default:true}
  const tx = fakeTransaction(t,async sql => {
    if (sql.includes('FROM customer_addresses') && sql.includes('LIMIT 1')) return {rows:[{id:addressId,is_default:false}]}
    if (sql.includes('RETURNING')) return {rows:[row]}
    return {rows:[]}
  })
  assert.equal(await repository.update(addressId,customerId,{...input,isDefault:true}),row)
  assert.equal(tx.calls.filter(([sql]) => sql.includes('UPDATE customer_addresses')).length,2)
  assert.equal(tx.calls.find(([sql]) => sql.includes('RETURNING'))[1][7],true)
})

test('AddressRepository.delete returns null for a missing address', async t => {
  const tx = fakeTransaction(t,async () => ({rows:[]}))
  assert.equal(await repository.delete(addressId,customerId),null)
  assert.equal(tx.calls.some(([sql]) => sql.includes('DELETE FROM')),false)
})

test('AddressRepository.delete promotes the next address after deleting the default', async t => {
  const before = {id:addressId,is_default:true}
  const tx = fakeTransaction(t,async sql => {
    if (sql.includes('LIMIT 1') && sql.includes('WHERE id =')) return {rows:[before]}
    if (sql.includes('ORDER BY created_at DESC')) return {rows:[{id:'next-address'}]}
    return {rows:[]}
  })
  assert.equal(await repository.delete(addressId,customerId),before)
  assert.deepEqual(tx.calls.find(([sql]) => sql.includes('is_default = true'))[1],['next-address',customerId])
})

test('AddressRepository.setDefault changes the selected address', async t => {
  const row = {id:addressId,is_default:true}
  const tx = fakeTransaction(t,async sql => {
    if (sql.includes('LIMIT 1')) return {rows:[{id:addressId,is_default:false}]}
    if (sql.includes('RETURNING')) return {rows:[row]}
    return {rows:[]}
  })
  assert.equal(await repository.setDefault(addressId,customerId),row)
  assert.deepEqual(tx.calls.find(([sql]) => sql.includes('is_default = true'))[1],[addressId,customerId])
})
