import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { pool, withTransaction } from '../src/config/database.js'
import { AuthRepository } from '../src/modules/auth/auth.repository.js'
import { BookingRepository } from '../src/modules/bookings/booking.repository.js'
import { PaymentsRepository } from '../src/modules/payments/payments.repository.js'
import { ReportsRepository } from '../src/modules/reports/reports.repository.js'
import { CustomerStatisticsRepository } from '../src/modules/customer-statistics/customer-statistics.repository.js'
import { TechnicianStatisticsRepository } from '../src/modules/technician-statistics/technician-statistics.repository.js'
import { TechnicianRepository } from '../src/modules/technicians/technician.repository.js'
import { CustomerNotificationsRepository } from '../src/modules/notifications/customer-notifications.repository.js'
import { UserRepository } from '../src/modules/users/user.repository.js'
import { validateUserListQuery } from '../src/modules/users/user.validation.js'
import { VoucherRepository } from '../src/modules/vouchers/voucher.repository.js'
import { validateVoucherListQuery } from '../src/modules/vouchers/voucher.validation.js'
import { TopupsRepository } from '../src/modules/topups/topups.repository.js'
import { validateTopupListQuery } from '../src/modules/topups/topups.validation.js'
import { WithdrawalsRepository } from '../src/modules/withdrawals/withdrawals.repository.js'
import { validateWithdrawalListQuery } from '../src/modules/withdrawals/withdrawals.validation.js'
import { TechnicianPortalRepository } from '../src/modules/technician-portal/technician-portal.repository.js'
import { ComplaintRepository } from '../src/modules/complaints/complaint.repository.js'
import { validateComplaintListQuery } from '../src/modules/complaints/complaint.validation.js'
import { TechnicianMutations } from '../src/modules/technicians/technician.mutations.js'

// Opt in on a revised-schema database. All write probes run inside rollbackTransaction.
const enabled = process.env.RUN_REVISED_DB_TESTS === '1'
if (enabled) after(async () => { await pool.end() })
const rollback = Symbol('rollback after integration check')
async function rollbackTransaction(work) {
  let value
  try {
    await withTransaction(async (client) => {
      value = await work(client)
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }
  return value
}

test('revised database decodes user and booking statuses', { skip: !enabled }, async () => {
  const user = await new AuthRepository().findUserByEmail('customer01@example.com')
  assert.equal(user.status, 'ACTIVE')
  assert.equal(user.gender, 'MALE')
  const bookings = new BookingRepository()
  const list = await bookings.list({ status: 'COMPLETED', page: 1, limit: 5 })
  assert.ok(list.total > 0)
  assert.equal(list.items[0].status, 'COMPLETED')
  assert.equal((await bookings.detail(list.items[0].id)).status, 'COMPLETED')
})

test('revised database preserves payment and technician read contracts', { skip: !enabled }, async () => {
  const payments = new PaymentsRepository()
  const list = await payments.listPayments({ status: 'SUCCESS', method: 'ALL', page: 1, limit: 5 })
  assert.ok(list.pagination.total > 0)
  assert.equal(list.items[0].status, 'SUCCESS')
  const detail = await payments.getPayment(list.items[0].id)
  assert.equal(detail.status, 'SUCCESS')
  const technician = new TechnicianRepository()
  const technicians = await technician.list({ status: 'ALL', verification: 'ALL',
    qualification: 'ALL', availability: 'ALL', sort: 'PRIORITY', page: 1, limit: 5 })
  assert.ok(technicians.total > 0)
  assert.equal(typeof technicians.items[0].verification_status, 'string')
})

test('revised database runs analytics and notifications SQL', { skip: !enabled }, async () => {
  const period = { from: '2026-09-01', to: '2026-11-01', granularity: 'day' }
  const reports = await new ReportsRepository().readReports(period)
  assert.ok(reports.bookingOverview)
  const filters = { ...period, search: '', page: 1, limit: 5 }
  const customers = await new CustomerStatisticsRepository().readCustomerStatistics(filters)
  assert.ok(customers.summary)
  const technicians = await new TechnicianStatisticsRepository().readTechnicianStatistics(filters)
  assert.ok(technicians.summary)
  const user = await new AuthRepository().findUserByEmail('customer01@example.com')
  const notifications = await new CustomerNotificationsRepository().list(user.id,
    { unreadOnly: false, limit: 5, offset: 0 })
  assert.equal(typeof notifications.pagination.total, 'number')
})

test('revised database runs other read paths with string filters', { skip: !enabled }, async () => {
  const users = await new UserRepository().list(validateUserListQuery({ status: 'ACTIVE' }))
  assert.ok(users.total > 0)
  assert.equal(users.items[0].status, 'ACTIVE')
  const vouchers = await new VoucherRepository().list(validateVoucherListQuery({}))
  assert.ok(vouchers.total > 0)
  assert.ok(['PERCENTAGE', 'FIXED_AMOUNT'].includes(vouchers.items[0].discount_type))
  const topups = await new TopupsRepository().listTopups(validateTopupListQuery({ status: 'SUCCESS' }))
  assert.ok(topups.pagination.total > 0)
  const withdrawals = await new WithdrawalsRepository().listWithdrawals(validateWithdrawalListQuery({}))
  assert.ok(withdrawals.pagination.total > 0)
  const complaints = await new ComplaintRepository().list(validateComplaintListQuery({}))
  assert.ok(complaints.total >= 0)
  const technician = await new AuthRepository().findUserByEmail('customer05@example.com')
  const dashboard = await new TechnicianPortalRepository().dashboard(technician.id)
  assert.ok(['ONLINE', 'OFFLINE', 'BUSY'].includes(dashboard.technician.availability_status))
})

test('revised database accepts enum writes within rolled-back transactions', { skip: !enabled }, async () => {
  const admin = await new AuthRepository().findUserByEmail('admin01@example.com')
  const customer = await new AuthRepository().findUserByEmail('customer01@example.com')
  const locked = await new UserRepository({ transaction: rollbackTransaction, audit: () => {} })
    .changeStatus(customer.id, 'LOCKED', admin.id)
  assert.equal(locked.status, 'LOCKED')
  const technician = await new AuthRepository().findUserByEmail('customer05@example.com')
  const availability = await new TechnicianPortalRepository({ transaction: rollbackTransaction })
    .setAvailability(technician.id, 'OFFLINE')
  assert.equal(availability.availability_status, 'OFFLINE')
  const booking = (await pool.query(`SELECT b.id FROM bookings b
    JOIN customer_profiles cp ON cp.id=b.customer_id
    WHERE cp.user_id=$1 AND NOT EXISTS (
      SELECT 1 FROM complaints c WHERE c.booking_id=b.id AND c.status IN (0,1)
    ) ORDER BY b.created_at LIMIT 1`, [customer.id])).rows[0]
  assert.ok(booking, 'A customer booking without an active complaint is required')
  const complaint = await new ComplaintRepository({ transaction: rollbackTransaction, audit: () => {} })
    .submit(customer.id, { booking_id: booking.id, type: 'SERVICE',
      subject: 'Kiểm tra dịch vụ demo', description: 'Mô tả kiểm thử giao dịch với schema mới.' })
  assert.equal(complaint.status, 'OPEN')
  assert.equal(complaint.type, 'SERVICE')
  const pending = (await pool.query("SELECT id FROM technician_profiles WHERE verification_status=0 ORDER BY id LIMIT 1")).rows[0]
  const reviewed = await new TechnicianMutations({ transaction: rollbackTransaction, audit: () => {} })
    .verification(pending.id, { status: 'VERIFIED', reason: null }, admin.id)
  assert.equal(reviewed.verification_status, 'VERIFIED')
})
