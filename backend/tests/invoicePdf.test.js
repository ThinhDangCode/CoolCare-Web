import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInvoicePdf,
  formatInvoicePdfAmount,
  formatInvoicePdfQuantity,
  safeInvoicePdfFilename,
} from '../src/modules/invoices/invoicePdf.js'

test('invoice PDF amounts retain exact large and fractional snapshot values', () => {
  assert.equal(formatInvoicePdfAmount('90071992547409930.01'), '90.071.992.547.409.930,01 ₫')
  assert.equal(formatInvoicePdfAmount('1234.5'), '1.234,50 ₫')
  assert.equal(formatInvoicePdfAmount('-0.01'), '-0,01 ₫')
  assert.equal(formatInvoicePdfAmount('0.00'), '0 ₫')
  for (const value of [null, undefined, 90071992547409930, '', 'NaN', '1e5', '1.001']) assert.equal(formatInvoicePdfAmount(value), '—')
})

test('invoice PDF quantities preserve decimals without a unit suffix and filenames stay safe', () => {
  assert.equal(formatInvoicePdfQuantity('2.000'), '2')
  assert.equal(formatInvoicePdfQuantity('1000.125'), '1.000,125')
  assert.equal(formatInvoicePdfQuantity(null), '—')
  const filename = safeInvoicePdfFilename({ invoiceNumber: '../../hóa đơn\r\nX-Test: value' })
  assert.match(filename, /^CoolCare-[a-zA-Z0-9._-]+\.pdf$/)
  assert.ok(!filename.includes('/'))
  assert.equal(safeInvoicePdfFilename({ invoiceNumber: '' }), 'CoolCare-invoice.pdf')
})

test('invoice PDF can paginate long real text, exact values and missing payment evidence', async () => {
  const result = await buildInvoicePdf({
    invoiceNumber: 'CC-PAGINATION-001', issuedAt: '2026-10-24T03:30:00.000Z', paymentStatus: 'UNRECORDED',
    customer: { name: 'Nguyễn Văn An', phone: '0909999123' },
    booking: { code: 'BK-001', address: 'Địa chỉ thực hiện '.repeat(90), completedAt: null },
    technician: null,
    totals: { subtotal: '90071992547409930.01', partsAmount: '0.00', discountAmount: '0.00', totalAmount: '90071992547409930.01' },
    items: [{ description: 'Dịch vụ bảo dưỡng máy lạnh '.repeat(100), quantity: '2.000', unitPrice: '90071992547409930.01', totalPrice: '90071992547409930.01', discountAmount: '0.01' }],
    payments: [],
  })
  assert.ok(Buffer.isBuffer(result))
  assert.equal(result.subarray(0, 5).toString(), '%PDF-')
  const pageCount = result.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0
  assert.ok(pageCount > 1, 'long invoice data should continue onto multiple A4 pages')
  assert.ok(result.includes(Buffer.from('%%EOF')))
})
