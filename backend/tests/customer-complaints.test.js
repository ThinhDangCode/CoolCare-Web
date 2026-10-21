import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateComplaintSubmission,
  validateCustomerComplaintQuery,
} from '../src/modules/complaints/complaint.validation.js'

test('customer complaint submission trims input and accepts all mobile complaint types', () => {
  const bookingId = '00000000-0000-4000-8000-000000000001'
  for (const type of ['SERVICE', 'TECHNICIAN', 'PAYMENT', 'OTHER']) {
    assert.deepEqual(
      validateComplaintSubmission({
        booking_id: bookingId,
        type,
        subject: '  Máy lạnh không đúng mô tả  ',
        description: '  Nội dung khiếu nại đủ dài để quản trị viên xem xét.  ',
      }),
      {
        booking_id: bookingId,
        type,
        subject: 'Máy lạnh không đúng mô tả',
        description: 'Nội dung khiếu nại đủ dài để quản trị viên xem xét.',
      }
    )
  }
})

test('customer complaint input rejects malformed IDs, types, lengths and extra fields', () => {
  const valid = {
    booking_id: '00000000-0000-4000-8000-000000000001',
    type: 'SERVICE',
    subject: 'Dịch vụ chưa tốt',
    description: 'Nội dung khiếu nại đủ dài để được xử lý.',
  }
  for (const body of [
    { ...valid, booking_id: 'wrong' },
    { ...valid, type: 'UNKNOWN' },
    { ...valid, type: 'PRODUCT' },
    { ...valid, subject: 'Ngắn' },
    { ...valid, description: 'Quá ngắn' },
    { ...valid, status: 'RESOLVED' },
  ]) assert.throws(() => validateComplaintSubmission(body), { status: 422 })
})

test('customer complaint pagination and status filters are bounded', () => {
  assert.deepEqual(validateCustomerComplaintQuery({}), { page: 1, limit: 20, status: 'ALL' })
  assert.deepEqual(validateCustomerComplaintQuery({ page: '2', limit: '50', status: 'OPEN' }), {
    page: 2,
    limit: 50,
    status: 'OPEN',
  })
  for (const query of [{ page: 0 }, { limit: 51 }, { status: 'UNKNOWN' }])
    assert.throws(() => validateCustomerComplaintQuery(query), { status: 422 })
})
