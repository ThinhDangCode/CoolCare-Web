import assert from 'node:assert/strict'
import test from 'node:test'
import { ReviewRepository } from '../src/modules/reviews/review.repository.js'

const userId = '12345678-1234-1234-1234-123456789012'
const customerId = '22345678-1234-1234-1234-123456789012'
const bookingId = '32345678-1234-1234-1234-123456789012'
const technicianId = '42345678-1234-1234-1234-123456789012'

function repositoryFixture(bookingCode) {
  const queries = []
  const repository = new ReviewRepository({
    transaction: async work => work({
      async query(sql, params) {
        queries.push({ sql, params })
        if (sql.includes('FROM customer_profiles')) return { rows: [{ id: customerId }] }
        if (sql.includes('SELECT b.id,b.booking_code')) {
          return { rows: [{ id: bookingId, booking_code: bookingCode, status: 'COMPLETED', technician_id: technicianId }] }
        }
        if (sql.includes('INSERT INTO reviews')) return { rows: [{ id: 'review-id', booking_id: bookingId }] }
        return { rows: [] }
      },
    }),
  })
  return { repository, queries }
}

test('creating a review notifies the reviewed technician in the same transaction', async () => {
  const { repository, queries } = repositoryFixture('BK-001')
  await repository.create(userId, { booking_id: bookingId, rating: 5, comment: 'Dịch vụ rất tốt' })

  const notification = queries.find(({ sql }) => sql.includes('INSERT INTO notifications'))
  assert.ok(notification)
  assert.match(notification.sql, /'BOOKING','Bạn nhận được đánh giá mới'/)
  assert.equal(notification.params[0], technicianId)
  assert.match(notification.params[1], /5\/5 sao/)
  assert.match(notification.params[1], /Dịch vụ rất tốt/)
  assert.equal(notification.params[2], bookingId)
})

test('a star-only review still creates a useful technician notification', async () => {
  const { repository, queries } = repositoryFixture('BK-002')
  await repository.create(userId, { booking_id: bookingId, rating: 4, comment: null })
  const notification = queries.find(({ sql }) => sql.includes('INSERT INTO notifications'))
  assert.equal(notification.params[1], 'Bạn nhận được đánh giá 4/5 sao cho booking BK-002.')
})
