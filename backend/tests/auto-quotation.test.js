import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureDefaultQuotation } from '../src/modules/quotations/auto-quotation.js'

test('materializes the original booking price as an accepted initial quotation', async () => {
  const calls = []
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (sql.startsWith('SELECT id, status, total_amount FROM quotations')) return { rows: [] }
      if (sql.includes('FROM booking_unit_services')) {
        return {
          rows: [
            {
              booking_unit_service_id: 'bus-1',
              service_id: 'service-1',
              name: 'Vệ sinh máy lạnh',
              unit_price: '200000',
            },
          ],
        }
      }
      if (sql.includes('INSERT INTO quotations')) {
        return { rows: [{ id: 'quotation-1', status: 'ACCEPTED' }] }
      }
      return { rows: [] }
    },
  }

  await ensureDefaultQuotation(db, 'booking-1', 'technician-1')

  const initial = calls.find(({ sql }) => sql.includes('INSERT INTO quotations'))
  assert.ok(initial)
  assert.equal(initial.params[2], 200000)
  assert.match(initial.sql, /'INITIAL'/)
  assert.match(initial.sql, /'ACCEPTED'/)
  assert.ok(calls.some(({ sql }) => sql.includes('refresh_booking_pricing')))
})
