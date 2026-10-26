import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatInvoiceAmount,
  formatInvoiceQuantity,
  formatInvoiceTime,
  invoiceDetailErrorMessage,
  invoiceDetailUrl,
  invoiceListUrl,
  validInvoiceId,
} from './invoicePresentation.js'

const id = '6af32092-a705-4f56-9398-7d4edb13d73e'

test('detail links round-trip normalized invoice filters and literal search after reload', () => {
  const query = new URLSearchParams({
    search: 'INV_A&B #1',
    period: 'all',
    status: 'UNRECORDED',
    service: id,
    page: '3',
    limit: '25',
    returnTo: 'https://untrusted.example/',
  })
  const detail = invoiceDetailUrl(id, query)
  assert.equal(detail.startsWith(`/admin/invoices/${id}?`), true)
  const saved = new URL(detail, 'http://localhost').search
  assert.equal(invoiceListUrl(saved), invoiceListUrl(query))
  const filters = new URLSearchParams(saved)
  assert.equal(filters.get('search'), 'INV_A&B #1')
  assert.equal(filters.get('period'), 'all')
  assert.equal(filters.get('page'), '3')
  assert.equal(filters.get('limit'), '25')
  assert.equal(filters.has('returnTo'), false)
})

test('malformed route IDs never become detail URLs', () => {
  assert.equal(validInvoiceId(id), true)
  for (const value of ['', null, '../payments', `${id}/edit`, 'javascript:alert(1)']) {
    assert.equal(validInvoiceId(value), false)
    assert.equal(invoiceDetailUrl(value), null)
  }
})

test('detail amounts and quantities localize exact decimals without unsafe floating point', () => {
  assert.equal(formatInvoiceAmount('9007199254740993.25', 'vi'), '9.007.199.254.740.993,25 ₫')
  assert.equal(formatInvoiceAmount('1200.50', 'vi'), '1.200,50 ₫')
  assert.equal(formatInvoiceAmount('1200.5'), '1,200.50 ₫')
  assert.equal(formatInvoiceAmount('0.00', 'vi'), '0 ₫')
  assert.equal(formatInvoiceAmount('invalid', 'vi'), '—')
  assert.equal(formatInvoiceQuantity('9007199254740993.125', 'vi'), '9.007.199.254.740.993,125')
  assert.equal(formatInvoiceQuantity('2.500', 'vi'), '2,5')
  assert.equal(formatInvoiceQuantity('0.000'), '0')
  assert.equal(formatInvoiceQuantity(null), '—')
  assert.equal(formatInvoiceQuantity('Infinity'), '—')
})

test('invoice time uses Vietnam midnight and a 24-hour clock', () => {
  assert.equal(formatInvoiceTime('2026-10-31T17:05:00Z'), '01/11/2026, 00:05')
  assert.equal(formatInvoiceTime(null), '—')
  assert.equal(formatInvoiceTime('invalid'), '—')
})

test('detail errors distinguish invalid, missing, permission and connection without exposing server details', () => {
  assert.equal(invoiceDetailErrorMessage({ status: 404 }), 'This invoice could not be found.')
  assert.equal(invoiceDetailErrorMessage({ status: 422 }), 'The invoice ID is invalid.')
  assert.equal(
    invoiceDetailErrorMessage({ status: 403 }),
    'You do not have permission to view invoices.'
  )
  assert.equal(
    invoiceDetailErrorMessage({ status: 401 }),
    'Your session has expired. Please sign in again.'
  )
  assert.equal(
    invoiceDetailErrorMessage({ message: 'Internal database connection' }),
    'Unable to connect to the server. Please try again.'
  )
  assert.equal(
    invoiceDetailErrorMessage({ status: 500, message: 'SQL secret' }),
    'Unable to load invoice details. Please try again.'
  )
})
