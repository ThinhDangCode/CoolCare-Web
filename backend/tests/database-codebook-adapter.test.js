import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptDatabaseQuery, adaptDatabaseResult } from '../src/config/database-codebook-adapter.js'
import { apiCode, databaseCodebooks, storageCode } from '../src/config/database-codebooks.js'
import { CUSTOMER_STATISTICS_SQL } from '../src/modules/customer-statistics/customer-statistics.repository.js'
import { buildTechnicianStatisticsSql } from '../src/modules/technician-statistics/technician-statistics.repository.js'
import { buildReportsAggregationSql } from '../src/modules/reports/reports.repository.js'
import { buildRevenueAggregationSql } from '../src/modules/revenue/revenue.repository.js'

test('storage codebooks keep the database and API contracts', () => {
  assert.equal(storageCode('bookings', 'status', 'COMPLETED'), 9)
  assert.equal(storageCode('booking_technicians', 'status', 'COMPLETED'), 6)
  assert.equal(storageCode('quotations', 'status', 'PENDING'), 1)
  assert.equal(storageCode('payments', 'payment_status', 'SUCCESS'), 2)
  assert.equal(apiCode('notifications', 'type', 7), 'SYSTEM')
  assert.equal(databaseCodebooks.customer_profiles.gender[0], 'MALE')
})

test('rewrites status predicates and parameters without changing payment method codes', () => {
  const adapted = adaptDatabaseQuery(
    "SELECT p.id FROM payments p JOIN payment_methods m ON m.id=p.payment_method_id WHERE p.payment_status IN ('PENDING','PROCESSING') AND m.code='CASH' AND p.payment_kind=$1",
    ['CASH'])
  assert.match(adapted.query, /payment_status IN \(0,1\)/)
  assert.match(adapted.query, /m.code='CASH'/)
  assert.deepEqual(adapted.params, [0])
})

test('rewrites insert VALUES and INSERT SELECT by target column', () => {
  const insert = adaptDatabaseQuery(
    "INSERT INTO notifications(user_id,type,title) VALUES($1,'BOOKING',$2)", ['user', 'title'])
  assert.match(insert.query, /VALUES\(\$1,0,\$2\)/)
  const selected = adaptDatabaseQuery(
    "INSERT INTO notifications(user_id,type,title) SELECT u.id,'BOOKING',$1 FROM users u WHERE u.id=$2",
    ['title', 'user'])
  assert.match(selected.query, /SELECT u.id,0,\$1 FROM users/)
  const parameter = adaptDatabaseQuery(
    'INSERT INTO technician_profiles(user_id,verification_status) VALUES($1,$2::varchar)',
    ['user', 'VERIFIED'])
  assert.match(parameter.query, /VALUES\(\$1,\$2\)/)
  assert.deepEqual(parameter.params, ['user', 1])
})

test('rewrites CASE operands for assignment priority', () => {
  const sql = "SELECT CASE bt.status WHEN 'COMPLETED' THEN 1 WHEN 'ACCEPTED' THEN 2 ELSE 3 END FROM booking_technicians bt"
  assert.match(adaptDatabaseQuery(sql).query, /CASE bt\.status WHEN 6 THEN 1 WHEN 2 THEN 2/)
})

test('decodes direct PostgreSQL columns and API aliases', async () => {
  const result = { fields: [
    { name: 'booking_status', tableID: 101, columnID: 3 },
    { name: 'payment_status', tableID: 102, columnID: 4 },
  ], rows: [{ booking_status: 9, payment_status: 2 }] }
  const rawQuery = async () => ({ rows: [
    { oid: 101, relname: 'bookings', attnum: 3, attname: 'status' },
    { oid: 102, relname: 'payments', attnum: 4, attname: 'payment_status' },
  ] })
  await adaptDatabaseResult(result, 'SELECT b.status AS booking_status,p.payment_status FROM bookings b JOIN payments p ON p.booking_id=b.id', rawQuery)
  assert.deepEqual(result.rows[0], { booking_status: 'COMPLETED', payment_status: 'SUCCESS' })
})

test('analytics queries compare revised numeric statuses', () => {
  const customer = adaptDatabaseQuery(CUSTOMER_STATISTICS_SQL).query
  assert.match(customer, /b\.status=10/)
  assert.match(customer, /q\.status=3/)
  assert.match(customer, /WHERE status=9/)
  const technician = adaptDatabaseQuery(buildTechnicianStatisticsSql()).query
  assert.match(technician, /a\.status IN \(2,6\)/)
  assert.match(technician, /r\.status=0/)
  assert.match(technician, /status IN \(0,1\)/)
  const reports = adaptDatabaseQuery(buildReportsAggregationSql()).query
  assert.match(reports, /p\.payment_status=2/)
  assert.match(reports, /status=9/)
  const revenue = adaptDatabaseQuery(buildRevenueAggregationSql()).query
  assert.match(revenue, /p\.payment_status=2/)
  assert.match(revenue, /qi\.item_type IN \(0,1\)/)
})
