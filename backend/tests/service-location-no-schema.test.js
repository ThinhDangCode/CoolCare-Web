import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { adaptDatabaseQuery } from '../src/config/database-codebook-adapter.js'
import { CustomerBookingController } from '../src/modules/customer-bookings/customer-booking.controller.js'
import { CustomerBookingRepository } from '../src/modules/customer-bookings/customer-booking.repository.js'
import { CustomerBookingService } from '../src/modules/customer-bookings/customer-booking.service.js'
import { sameServiceLocation } from '../src/modules/customer-bookings/service-location.sql.js'

const id = n => `${n}2345678-1234-1234-1234-123456789012`
const [user, customer, address, brand, model, serviceId, booking] = [1,2,3,4,5,6,7].map(id)

function checkAddressMatch(sql) {
  assert.doesNotMatch(sql, /service_location_id|b\.customer_address_id/)
  for (const field of ['service_address','ward','city']) assert.ok(sql.includes(`b.${field}`))
  for (const field of ['address_line','ward','city']) assert.ok(sql.includes(`selected_address.${field}`))
  assert.match(sql, /lower\(btrim\(regexp_replace/)
  assert.match(adaptDatabaseQuery(sql, []).query, /b\.status=9/)
}

test('customer address lookup uses only existing columns and locks the saved address for booking creation', async () => {
  const repository = new CustomerBookingRepository({db: {query: async (sql, params) => {
    assert.doesNotMatch(sql, /service_location_id/)
    assert.match(sql, /FOR SHARE/)
    assert.deepEqual(params, [address, customer])
    return {rows: [{id: address}]}
  }}})
  assert.equal((await repository.findAddress(customer,address)).id, address)
})

test('previous AC models are scoped to the authenticated customer and saved address snapshot', async t => {
  t.mock.method(pool, 'query', async (sql, params) => {
    checkAddressMatch(sql)
    assert.match(sql, /cp\.user_id=\$1/)
    assert.match(sql, /selected_address\.customer_id=cp\.id/)
    assert.deepEqual(params, [user,address])
    return {rows: [{brandId: brand, modelId: model}]}
  })
  let result
  const response = {status(code) {assert.equal(code,200);return this},json(body) {result=body}}
  await new CustomerBookingController().getPreviousAcUnits({auth:{userId:user},query:{addressId:address}},response)
  assert.deepEqual(result.data.items, [{brandId:brand,modelId:model}])
})

for (const matching of [true,false]) test(`create booking ${matching?'accepts':'rejects'} previous model based on same location`, async t => {
  let created = false
  const db = {query: async (sql, params) => {
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return {rows:[]}
    if (sql.includes('COUNT(*)')) return {rows:[{total:0}]}
    if (sql.includes('scheduled_at BETWEEN')) return {rowCount:0}
    if (sql.includes('JOIN booking_units')) {
      checkAddressMatch(sql)
      assert.match(sql, /selected_address\.customer_id=b\.customer_id/)
      assert.deepEqual(params,[customer,address,brand,model])
      return {rowCount:matching?1:0}
    }
    throw Error(`Unexpected query: ${sql}`)
  },release(){}}
  t.mock.method(pool,'connect',async()=>db)
  const repository = {
    findCustomer:async()=>({id:customer}),findAddress:async()=>({id:address,address_line:'1 ABC',ward:'Ninh Kiều',city:'Cần Thơ'}),
    findActiveServices:async()=>[{id:serviceId,base_price:100000}],findBrand:async()=>({id:brand}),findModel:async()=>({id:model}),
    createBooking:async(data)=>{created=true;assert.equal(data.addressLine,'1 ABC');return {id:booking,status:'PENDING',subtotal:100000,discount_amount:0,total_amount:100000}},
    createUnit:async()=>({id:booking}),createUnitService:async()=>{},insertStatusHistory:async()=>{},
  }
  const input={customerAddressId:address,recipientName:'Test',recipientPhone:'0900000000',scheduledAt:new Date(Date.now()+86400000).toISOString(),units:[{acBrandId:brand,acModelId:model,serviceIds:[serviceId]}]}
  const result = new CustomerBookingService(repository).createBooking(user,input)
  if (matching) assert.equal((await result).status,'PENDING')
  else await assert.rejects(result,{code:'AC_MODEL_NOT_PREVIOUSLY_CONFIRMED'})
  assert.equal(created,matching)
})

// Optional read-only SQL check against PostgreSQL. No test fixtures or schema writes.
test('PostgreSQL compares normalized address snapshots without new columns', {skip:process.env.RUN_SERVICE_LOCATION_DB_TESTS !== '1'}, async()=>{
  try {
    const result = await pool.query(`WITH b(service_address,ward,city) AS (VALUES ('  12  ABC  ','Ninh Kiều','Cần Thơ')),
      selected_address(address_line,ward,city) AS (VALUES ('12 abc','NINH KIỀU','Cần Thơ'),('13 abc','Ninh Kiều','Cần Thơ'),('12 abc','Cái Khế','Cần Thơ'))
      SELECT selected_address.address_line,selected_address.ward,(${sameServiceLocation('b','selected_address')}) AS matches FROM b CROSS JOIN selected_address`)
    assert.equal(result.rows.filter(row=>row.matches).length,1)
    assert.equal(result.rows.find(row=>row.matches).address_line,'12 abc')
  } finally {await pool.end()}
})
