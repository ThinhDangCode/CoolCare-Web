import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { createManagementRouter } from '../src/modules/management/management.routes.js'
import {
  validateBlogInput,
  validateBlogStatus,
  validateComplaintResolution,
  validateManagementListQuery,
  validateUserStatus,
  validateVoucherInput,
} from '../src/modules/management/management.validation.js'
import { errorHandler } from '../src/middleware/error-handler.js'

const adminId = '12345678-1234-1234-1234-123456789012'
const targetId = '22345678-1234-1234-1234-123456789012'

test('Sprint 3 validation bounds filters, account status and voucher data', () => {
  assert.equal(validateManagementListQuery({}, 'users').limit, 10)
  assert.deepEqual(
    validateManagementListQuery({ voucher_search: ' SAVE ', customer_search: ' Dũng ' }, 'usages'),
    {
      page: 1,
      limit: 10,
      search: '',
      voucherSearch: 'SAVE',
      customerSearch: 'Dũng',
      status: 'ALL',
      role: 'ALL',
      voucherId: undefined,
      sort: undefined,
      period: 'THIS_MONTH',
      fromDate: undefined,
      toDate: undefined,
    }
  )
  assert.equal(
    validateManagementListQuery({ period: 'ALL_TIME', status: 'USED' }, 'usages').period,
    'ALL_TIME'
  )
  assert.throws(() => validateManagementListQuery({ period: 'LAST_YEAR' }, 'usages'), {
    status: 422,
  })
  assert.equal(
    validateManagementListQuery({ from_date: '2026-10-01', to_date: '2026-10-31' }, 'usages')
      .toDate,
    '2026-10-31'
  )
  assert.throws(
    () => validateManagementListQuery({ from_date: '2026-10-31', to_date: '2026-10-01' }, 'usages'),
    { status: 422 }
  )
  assert.equal(validateManagementListQuery({ sort: 'OLDEST' }, 'vouchers').sort, 'OLDEST')
  assert.throws(() => validateManagementListQuery({ sort: 'RANDOM' }, 'vouchers'), { status: 422 })
  for (const query of [{ page: 0 }, { limit: 101 }, { status: 'UNKNOWN' }, { role: 'OWNER' }])
    assert.throws(() => validateManagementListQuery(query, 'users'), { status: 422 })
  assert.equal(validateUserStatus({ status: 'LOCKED' }), 'LOCKED')
  assert.throws(() => validateUserStatus({ status: 'INACTIVE' }), { status: 422 })
  const voucher = {
    code: ' save20 ',
    name: 'Save 20%',
    discount_type: 'PERCENTAGE',
    discount_value: 20,
    minimum_order_amount: 100000,
    start_at: '2026-10-10T00:00:00Z',
    end_at: '2026-10-11T00:00:00Z',
  }
  assert.equal(validateVoucherInput(voucher).code, 'SAVE20')
  for (const change of [
    { discount_value: 101 },
    { discount_value: 20.01 },
    { code: '' },
    { code: 'SAVE 20' },
    { discount_type: 'OTHER' },
    { usage_limit: 2, usage_limit_per_customer: 3 },
    { end_at: '2026-10-09T00:00:00Z' },
  ])
    assert.throws(() => validateVoucherInput({ ...voucher, ...change }), { status: 422 })
})

test('Blog and complaint validation matches database states', () => {
  assert.deepEqual(
    validateManagementListQuery({ status: 'PUBLISHED', sort: 'OLDEST' }, 'blogs').status,
    'PUBLISHED'
  )
  assert.equal(
    validateManagementListQuery({ status: 'OPEN', type: 'PAYMENT' }, 'complaints').type,
    'PAYMENT'
  )
  assert.equal(
    validateBlogInput({
      title: 'How to maintain an AC',
      slug: 'how-to-maintain-an-ac',
      content: 'A complete maintenance guide for CoolCare customers.',
    }).status,
    'DRAFT'
  )
  assert.equal(validateBlogStatus({ status: 'HIDDEN' }), 'HIDDEN')
  assert.deepEqual(
    validateComplaintResolution({
      status: 'RESOLVED',
      resolution: 'Customer received a full explanation and refund.',
    }),
    { status: 'RESOLVED', resolution: 'Customer received a full explanation and refund.' }
  )
  assert.throws(
    () =>
      validateBlogInput({
        title: 'Post',
        slug: 'Invalid Slug',
        content: 'Valid content long enough for this test.',
      }),
    { status: 422 }
  )
  assert.throws(() => validateBlogStatus({ status: 'ACTIVE' }), { status: 422 })
  assert.throws(() => validateComplaintResolution({ status: 'RESOLVED', resolution: 'short' }), {
    status: 422,
  })
})

test('Sprint 3 routes are Admin-only and include the actor on mutations', async () => {
  const calls = []
  const repository = {
    async listUsers(value) {
      calls.push(['listUsers', value])
      return { items: [], total: 0 }
    },
    async changeUserStatus(...value) {
      calls.push(['changeUserStatus', ...value])
      return { id: value[0], status: value[1] }
    },
    async listVouchers(value) {
      calls.push(['listVouchers', value])
      return { items: [], total: 0 }
    },
    async mutateVoucher(...value) {
      calls.push(['mutateVoucher', ...value])
      return { id: targetId, ...value[1] }
    },
    async listVoucherUsages(value) {
      calls.push(['listVoucherUsages', value])
      return { items: [], total: 0 }
    },
    async listBlogs(value) {
      calls.push(['listBlogs', value])
      return { items: [], total: 0 }
    },
    async mutateBlog(...value) {
      calls.push(['mutateBlog', ...value])
      return { id: targetId, ...value[1] }
    },
    async listComplaints(value) {
      calls.push(['listComplaints', value])
      return { items: [], total: 0 }
    },
    async resolveComplaint(...value) {
      calls.push(['resolveComplaint', ...value])
      return { id: targetId, ...value[1] }
    },
  }
  const app = express()
  app.use(express.json())
  app.use('/admin', createManagementRouter(repository))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const sign = (role) =>
    jwt.sign({ sub: adminId, role, purpose: 'access' }, env.jwtSecret, { expiresIn: '5m' })
  const request = (path, role, method = 'GET', body) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(role ? { Authorization: `Bearer ${sign(role)}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  try {
    assert.equal((await request('/admin/users')).status, 401)
    assert.equal((await request('/admin/users', 'CUSTOMER')).status, 403)
    assert.equal((await request('/admin/users', 'ADMIN')).status, 200)
    assert.equal(
      (await request(`/admin/users/${targetId}/status`, 'ADMIN', 'PATCH', { status: 'LOCKED' }))
        .status,
      200
    )
    assert.deepEqual(calls.at(-1).slice(1), [targetId, 'LOCKED', adminId])
    assert.equal(
      (
        await request('/admin/vouchers', 'ADMIN', 'POST', {
          code: 'SAVE',
          name: 'Save',
          discount_type: 'FIXED_AMOUNT',
          discount_value: 1000,
          minimum_order_amount: 0,
          start_at: '2026-10-10T00:00:00Z',
          end_at: '2026-10-11T00:00:00Z',
        })
      ).status,
      201
    )
    assert.equal(calls.at(-1)[3], adminId)
    assert.equal((await request('/admin/voucher-usages', 'ADMIN')).status, 200)
    assert.equal((await request('/admin/blogs', 'ADMIN')).status, 200)
    assert.equal(
      (
        await request('/admin/blogs', 'ADMIN', 'POST', {
          title: 'A useful CoolCare article',
          slug: 'a-useful-coolcare-article',
          content: 'Detailed content for CoolCare customers and technicians.',
        })
      ).status,
      201
    )
    assert.equal(calls.at(-1)[3], adminId)
    assert.equal((await request('/admin/complaints?type=SERVICE', 'ADMIN')).status, 200)
    assert.equal(
      (
        await request(`/admin/complaints/${targetId}/resolve`, 'ADMIN', 'PATCH', {
          status: 'RESOLVED',
          resolution: 'The service issue was investigated and resolved.',
        })
      ).status,
      200
    )
    assert.equal(calls.at(-1)[3], adminId)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
