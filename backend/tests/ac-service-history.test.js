import assert from 'node:assert/strict'
import test from 'node:test'
import { AcServiceHistoryRepository } from '../src/modules/technician-portal/ac-service-history.repository.js'
import { AcServiceHistoryService } from '../src/modules/technician-portal/ac-service-history.service.js'
import { validateAcServiceHistoryQuery } from '../src/modules/technician-portal/ac-service-history.validation.js'

const userId = '12345678-1234-1234-1234-123456789012'
const requestId = '22345678-1234-1234-1234-123456789012'
const unitId = '32345678-1234-1234-1234-123456789012'

test('AC service history validates pagination', () => {
  assert.deepEqual(validateAcServiceHistoryQuery({}), { page: 1, limit: 20, offset: 0 })
  assert.deepEqual(validateAcServiceHistoryQuery({ page: '2', limit: '10' }), { page: 2, limit: 10, offset: 10 })
  assert.throws(() => validateAcServiceHistoryQuery({ limit: '51' }), { status: 422 })
  assert.throws(() => validateAcServiceHistoryQuery({ sort: 'newest' }), { status: 422 })
})

test('AC service history denies a unit outside the assigned active job', async () => {
  const service = new AcServiceHistoryService({ findAccessibleUnit: async () => null })
  await assert.rejects(service.getHistory(userId, requestId, unitId), {
    status: 404, code: 'AC_UNIT_NOT_ACCESSIBLE',
  })
})

test('AC service history repository scopes access and sorts completed visits newest first', async () => {
  const queries = []
  const repository = new AcServiceHistoryRepository({
    queryable: { async query(sql, params) { queries.push({ sql, params }); return { rows: [] } } },
  })
  await repository.findAccessibleUnit(userId, requestId, unitId)
  await repository.findHistory(
    { unit_id: unitId, customer_id: 'customer-id', booking_id: 'current-booking' },
    { limit: 20, offset: 0 },
  )
  assert.match(queries[0].sql, /tp\.user_id=\$1/)
  assert.match(queries[0].sql, /bt\.id=\$2/)
  assert.match(queries[0].sql, /current_unit\.id=\$3/)
  assert.match(queries[0].sql, /bt\.status='ACCEPTED'/)
  assert.match(queries[1].sql, /history_booking\.customer_id=\$2/)
  assert.match(queries[1].sql, /history_booking\.status='COMPLETED'/)
  assert.match(queries[1].sql, /q\.quotation_type='ADDITIONAL'/)
  assert.match(queries[1].sql, /q\.status='ACCEPTED'/)
  assert.match(queries[1].sql, /completed_at DESC NULLS LAST/)
})
