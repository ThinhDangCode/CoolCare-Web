import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { pool } from '../src/config/database.js'
import { validateCreateBookingBody } from '../src/modules/customer-bookings/customer-booking.validation.js'
import { CustomerBookingRepository } from '../src/modules/customer-bookings/customer-booking.repository.js'
import { TechnicianMatchingRepository } from '../src/modules/customer-bookings/technician-matching.repository.js'
import { AcceptDeclineJobRequestRepository } from '../src/modules/technician-portal/accept-decline-job-request.repository.js'
import { CancelAcceptedJobRepository } from '../src/modules/technician-portal/cancel-accepted-job.repository.js'
import { ChatService } from '../src/modules/chat/chat.service.js'

const enabled = process.env.RUN_JOB_REQUEST_DB_TESTS === '1'
if (enabled) after(async () => { await pool.end() })

test('customer booking input and database writes remain compatible with the live catalog', {
  skip: !enabled,
}, async (context) => {
  const db = await pool.connect()
  let bookingId
  try {
    await db.query('BEGIN')
    const fixture = (await db.query(`
      SELECT cp.user_id, ca.id AS address_id, s.id AS service_id
      FROM bookings b
      JOIN customer_profiles cp ON cp.id=b.customer_id
      JOIN customer_addresses ca ON ca.id=b.customer_address_id
      JOIN booking_units bu ON bu.booking_id=b.id
      JOIN booking_unit_services bus ON bus.booking_unit_id=bu.id
      JOIN services s ON s.id=bus.service_id
      WHERE b.status='PENDING' AND s.is_active=TRUE
      ORDER BY b.id LIMIT 1
    `)).rows[0]
    if (!fixture) {
      context.skip('Requires a customer address and active booked service')
      return
    }
    const input = validateCreateBookingBody({
      customerAddressId: fixture.address_id,
      recipientName: 'Rollback Test',
      recipientPhone: '0900000000',
      scheduledAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      units: [{ acBrandId: null, acModelId: null, serviceIds: [fixture.service_id] }],
    })
    const repository = new CustomerBookingRepository({ db })
    const customer = await repository.findCustomer(fixture.user_id, db)
    const address = await repository.findAddress(customer.id, input.customerAddressId, db)
    const [service] = await repository.findActiveServices([fixture.service_id], db)
    const booking = await repository.createBooking({
      customerId: customer.id,
      addressId: address.id,
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      description: input.description,
      addressLine: address.address_line,
      ward: address.ward,
      city: address.city,
      latitude: address.latitude,
      longitude: address.longitude,
      scheduledAt: input.scheduledAt,
      subtotal: Number(service.base_price),
    }, db)
    bookingId = booking.id
    const unit = await repository.createUnit(booking.id, 1, input.units[0], db)
    await repository.createUnitService(unit.id, service.id, service.base_price, db)
    await repository.insertStatusHistory(booking.id, fixture.user_id, db)
    assert.equal(booking.status, 'PENDING')
    assert.equal((await db.query('SELECT count(*)::int AS total FROM booking_unit_services WHERE booking_unit_id=$1', [unit.id])).rows[0].total, 1)
  } finally {
    await db.query('ROLLBACK')
    db.release()
  }
  assert.equal((await pool.query('SELECT 1 FROM bookings WHERE id=$1', [bookingId])).rowCount, 0)
})

test('customer selects a technician, technician accepts and chats, then cancellation applies a permanent two-point penalty', {
  skip: !enabled,
}, async (context) => {
  const db = await pool.connect()
  let requestId
  let messageId
  let penaltyId
  try {
    await db.query('BEGIN')
    const pending = (await db.query(`
      SELECT b.id, cp.user_id
      FROM bookings b JOIN customer_profiles cp ON cp.id = b.customer_id
      WHERE b.status = 'PENDING' ORDER BY b.id
    `)).rows
    const matching = new TechnicianMatchingRepository({ db })
    let selected
    for (const booking of pending) {
      await db.query('SAVEPOINT booking_probe')
      // Existing local fixtures may have past appointment dates. This change
      // remains inside the test transaction and is always rolled back.
      await db.query("UPDATE bookings SET scheduled_at=CURRENT_TIMESTAMP+INTERVAL '7 days' WHERE id=$1", [booking.id])
      const recommendations = await matching.findRecommendedTechnicians(booking.id, { limit: 50 }, db)
      for (const technician of recommendations) {
        const previous = await db.query(
          'SELECT 1 FROM booking_technicians WHERE booking_id=$1 AND technician_id=$2',
          [booking.id, technician.id],
        )
        if (!previous.rowCount) {
          selected = { booking, technician }
          break
        }
      }
      if (selected) {
        await db.query('RELEASE SAVEPOINT booking_probe')
        break
      }
      await db.query('ROLLBACK TO SAVEPOINT booking_probe')
      await db.query('RELEASE SAVEPOINT booking_probe')
    }
    if (!selected) {
      context.skip('Requires a pending booking and an eligible new technician')
      return
    }

    const { booking, technician } = selected
    assert.equal((await matching.lockCustomerBooking(booking.id, booking.user_id, db)).status, 'PENDING')
    assert.equal(await matching.findExistingRequest(booking.id, db), null)
    assert.ok(await matching.lockTechnician(technician.id, db))
    assert.ok(await matching.findEligibleTechnician(booking.id, technician.id, db))
    const request = await matching.insertTechnicianRequest(booking.id, technician.id, db)
    requestId = request.id
    assert.equal(request.status, 'SELECTED')
    assert.equal((await matching.markTechnicianSelected(booking.id, db)).status, 'TECHNICIAN_SELECTED')
    await matching.insertBookingStatusHistory(booking.id, booking.user_id, db)
    await matching.notifyTechnicianOfNewRequest(booking.id, technician.id, db)

    const jobRequests = new AcceptDeclineJobRequestRepository({ transaction: work => work(db) })
    await db.query('SAVEPOINT debt_probe')
    await db.query('UPDATE technician_accounts SET settlement_balance=-1000000 WHERE technician_id=$1', [technician.id])
    await assert.rejects(
      jobRequests.respond(technician.user_id, request.id, { action: 'ACCEPT' }),
      { code: 'TECHNICIAN_DEBT_LIMIT' },
    )
    await db.query('ROLLBACK TO SAVEPOINT debt_probe')
    await db.query('RELEASE SAVEPOINT debt_probe')

    const accepted = await jobRequests.respond(technician.user_id, request.id, { action: 'ACCEPT' })
    assert.equal(accepted.status, 'ACCEPTED')
    assert.equal(accepted.booking.status, 'ACCEPTED')

    // ChatService manages a transaction of its own. Map it to a savepoint so
    // the complete flow can be rolled back as one database test.
    const chatDb = {
      query: (...args) => db.query(...args),
      connect: async () => ({
        query: (sql, params) => sql === 'BEGIN'
          ? db.query('SAVEPOINT chat_probe')
          : sql === 'COMMIT'
            ? db.query('RELEASE SAVEPOINT chat_probe')
            : sql === 'ROLLBACK'
              ? db.query('ROLLBACK TO SAVEPOINT chat_probe')
              : db.query(sql, params),
        release: () => {},
      }),
    }
    const chat = new ChatService({ db: chatDb })
    const room = await chat.getOrCreateRoom(booking.id, booking.user_id, 'CUSTOMER')
    const message = await chat.sendMessage(room.id, booking.user_id, 'CUSTOMER', 'Rollback flow check')
    messageId = message.id
    const technicianMessages = await chat.listMessages(room.id, technician.user_id, 'CUSTOMER')
    assert.equal(technicianMessages.at(-1).content, 'Rollback flow check')
    assert.ok((await chat.listRooms(technician.user_id)).some(item => item.id === room.id))

    const cancellation = await new CancelAcceptedJobRepository({ transaction: work => work(db) })
      .cancel(technician.user_id, request.id, 'Rollback flow check')
    penaltyId = cancellation.penalty.id
    assert.equal(cancellation.status, 'CANCELLED')
    assert.equal(cancellation.booking.status, 'PENDING')
    assert.equal(cancellation.penalty.penalty_points, 2)
    assert.equal(cancellation.penalty.expires_at, null)
    const afterCancellation = await matching.findRecommendedTechnicians(booking.id, { limit: 50 }, db)
    const selectedAfter = afterCancellation.find(item => item.id === technician.id)
    assert.ok(selectedAfter, 'The cancelled technician remains eligible but has lower priority')
    assert.equal(Number(selectedAfter.penalty_points), Number(technician.penalty_points) + 2)
    const selectedIndex = afterCancellation.indexOf(selectedAfter)
    assert.ok(afterCancellation.slice(0, selectedIndex).every(item =>
      Number(item.penalty_points) <= Number(selectedAfter.penalty_points)))
  } finally {
    await db.query('ROLLBACK')
    db.release()
  }
  assert.equal((await pool.query('SELECT 1 FROM booking_technicians WHERE id=$1', [requestId])).rowCount, 0)
  assert.equal((await pool.query('SELECT 1 FROM chat_messages WHERE id=$1', [messageId])).rowCount, 0)
  assert.equal((await pool.query('SELECT 1 FROM technician_penalties WHERE id=$1', [penaltyId])).rowCount, 0)
})
