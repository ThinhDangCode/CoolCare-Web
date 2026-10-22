// Database storage codes for the current PostgreSQL schema. The HTTP API still
// uses the existing string values so the web and mobile clients stay compatible.
export const databaseCodebooks = Object.freeze({
  users: { status: ['ACTIVE', 'LOCKED', 'INACTIVE'] },
  customer_profiles: { gender: ['MALE', 'FEMALE', 'OTHER'] },
  technician_profiles: {
    qualification_level: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'],
    verification_status: ['PENDING', 'VERIFIED', 'REJECTED'],
    availability_status: ['ONLINE', 'OFFLINE', 'BUSY'],
  },
  technician_skills: { skill_level: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] },
  technician_certifications: { verification_status: ['PENDING', 'VERIFIED', 'REJECTED'] },
  technician_certification_submissions: { verification_status: ['PENDING', 'VERIFIED', 'REJECTED'] },
  vouchers: { discount_type: ['PERCENTAGE', 'FIXED_AMOUNT'] },
  voucher_usages: {
    discount_type: ['PERCENTAGE', 'FIXED_AMOUNT'],
    status: ['RESERVED', 'USED', 'RELEASED'],
  },
  bookings: { status: ['PENDING', 'TECHNICIAN_SELECTED', 'ACCEPTED', 'IN_PROGRESS',
    'WAITING_QUOTATION', 'QUOTATION_SENT', 'QUOTATION_ACCEPTED', 'QUOTATION_REJECTED',
    'WAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'] },
  booking_status_history: { status: ['PENDING', 'TECHNICIAN_SELECTED', 'ACCEPTED', 'IN_PROGRESS',
    'WAITING_QUOTATION', 'QUOTATION_SENT', 'QUOTATION_ACCEPTED', 'QUOTATION_REJECTED',
    'WAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'] },
  booking_technicians: { status: ['RECOMMENDED', 'SELECTED', 'ACCEPTED', 'DECLINED',
    'NOT_SELECTED', 'EXPIRED', 'COMPLETED', 'CANCELLED'] },
  technician_penalties: {
    penalty_type: ['DECLINE', 'CANCELLATION', 'LATE_HANDLING', 'RULE_VIOLATION'],
    status: ['ACTIVE', 'EXPIRED', 'REVOKED'],
  },
  quotations: { quotation_type: ['INITIAL', 'ADDITIONAL'],
    status: ['DRAFT', 'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'] },
  quotation_items: { item_type: ['SERVICE', 'LABOR'] },
  payments: { payment_kind: ['CASH', 'ONLINE', 'FREE'],
    payment_status: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'] },
  technician_topups: { payment_status: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'] },
  withdrawals: { status: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'] },
  settlement_transactions: { transaction_type: ['CASH_SETTLEMENT', 'ONLINE_EARNING',
    'TOP_UP', 'WITHDRAWAL', 'ADJUSTMENT'] },
  settlements: { status: ['OPEN', 'CALCULATED', 'SETTLED', 'OVERDUE'] },
  invoice_items: { item_type: ['SERVICE', 'LABOR'] },
  reviews: { status: ['PUBLISHED', 'HIDDEN'] },
  complaints: { type: ['SERVICE', 'TECHNICIAN', 'PAYMENT', 'OTHER'],
    status: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED'] },
  notifications: { type: ['BOOKING', 'QUOTATION', 'PAYMENT', 'CHAT', 'COMPLAINT',
    'SETTLEMENT', 'MAINTENANCE', 'SYSTEM'] },
  chat_messages: { message_type: ['TEXT', 'IMAGE', 'FILE'] },
  blogs: { status: ['DRAFT', 'PUBLISHED', 'HIDDEN'] },
})

export function storageCode(table, column, value) {
  if (value == null || typeof value === 'number') return value
  const code = databaseCodebooks[table]?.[column]?.indexOf(value)
  return code == null || code < 0 ? value : code
}

export function apiCode(table, column, value) {
  if (value == null || typeof value !== 'number') return value
  return databaseCodebooks[table]?.[column]?.[value] ?? value
}
