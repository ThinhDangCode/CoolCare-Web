import test from 'node:test'
import assert from 'node:assert/strict'
import {
  initialInvoiceFilters,
  invoiceApiQuery,
  invoiceMonthRange,
  invoicePeriodLabel,
  readInvoiceFilters,
  writeInvoiceFilters,
} from './invoiceFilters.js'
import {
  formatInvoiceAmount,
  formatInvoiceDate,
  invoiceErrorMessage,
  invoicePdfUrl,
  invoiceServiceLabels,
} from './invoicePresentation.js'

const now = new Date('2026-10-31T17:00:00.000Z')

test('the default issued month changes at midnight in Vietnam, including year boundaries', () => {
  assert.deepEqual(initialInvoiceFilters(now), {
    search: '',
    status: 'ALL',
    service: 'ALL',
    from: '2026-11-01',
    to: '2026-11-30',
    page: 1,
    limit: 10,
  })
  assert.equal(initialInvoiceFilters(new Date('2026-12-31T17:00:00Z')).from, '2027-01-01')
  assert.equal(initialInvoiceFilters(new Date('2026-10-31T16:59:59Z')).from, '2026-10-01')
})

test('month ranges include leap days and reject invalid picker values', () => {
  assert.deepEqual(invoiceMonthRange('2028', '02'), { from: '2028-02-01', to: '2028-02-29' })
  assert.deepEqual(invoiceMonthRange('2026', '12'), { from: '2026-12-01', to: '2026-12-31' })
  assert.equal(invoiceMonthRange('2026', '13'), null)
  assert.equal(invoiceMonthRange('0000', '01'), null)
})

test('all time survives URL navigation without sending its UI marker to the API', () => {
  const filters = {
    ...initialInvoiceFilters(now),
    from: '',
    to: '',
    status: 'UNRECORDED',
    page: 3,
    limit: 25,
  }
  const saved = writeInvoiceFilters(filters)
  assert.equal(saved.get('period'), 'all')
  assert.deepEqual(readInvoiceFilters(saved, now), filters)
  const api = new URLSearchParams(invoiceApiQuery(filters))
  assert.equal(api.has('period'), false)
  assert.equal(api.has('from'), false)
  assert.equal(api.has('to'), false)
  assert.equal(api.get('page'), '3')
  assert.equal(api.get('status'), 'UNRECORDED')
})

test('saved invoice filters preserve the selected month, service and literal search', () => {
  const filters = {
    ...initialInvoiceFilters(now),
    from: '2028-02-01',
    to: '2028-02-29',
    search: 'INV_%',
    service: '6af32092-a705-4f56-9398-7d4edb13d73e',
    status: 'PAID',
    limit: 50,
  }
  assert.deepEqual(readInvoiceFilters(writeInvoiceFilters(filters), now), filters)
  assert.equal(invoicePeriodLabel(filters), '02/2028')
  assert.equal(invoicePeriodLabel({ from: '', to: '' }), 'All time')
})

test('malformed dates and unsupported filter values return safe defaults', () => {
  const filters = readInvoiceFilters(
    new URLSearchParams({
      from: '2026-02-30',
      to: '2026-03-01',
      status: 'REFUNDED',
      service: 'invalid',
      page: '1000001',
      limit: '999',
      search: '  A\nB  ',
    }),
    now
  )
  assert.deepEqual(filters, { ...initialInvoiceFilters(now), search: 'AB' })
  assert.equal(
    readInvoiceFilters(new URLSearchParams({ from: '2026-11-02', to: '2026-11-01' }), now).from,
    '2026-11-01'
  )
})

test('invoice amounts preserve exact decimal strings and issue dates use Vietnam time', () => {
  assert.equal(formatInvoiceAmount('9007199254740993.25'), '9,007,199,254,740,993.25 ₫')
  assert.equal(formatInvoiceAmount('0.00'), '0 ₫')
  assert.equal(formatInvoiceAmount(null), '—')
  assert.equal(formatInvoiceDate('2026-10-31T17:00:00Z'), '01/11/2026')
  assert.equal(formatInvoiceDate('invalid'), '—')
})

test('PDF links require HTTP(S) and never include embedded credentials or active schemes', () => {
  assert.equal(
    invoicePdfUrl('https://files.example.com/invoice.pdf'),
    'https://files.example.com/invoice.pdf'
  )
  for (const value of [
    'javascript:alert(1)',
    'data:application/pdf,test',
    'file:///invoice.pdf',
    'https://user:password@files.example.com/test.pdf',
    '/invoice.pdf',
    null,
  ]) {
    assert.equal(invoicePdfUrl(value), null)
  }
})

test('multiple service labels keep unlinked labor visible and translate their fallbacks', () => {
  const translate = (key) => `translated:${key}`
  assert.deepEqual(
    invoiceServiceLabels(
      { services: [{ name: 'Cleaning' }, { name: ' Repair ' }], hasUnlinkedLabor: true },
      translate
    ),
    ['Cleaning', 'Repair', 'translated:Additional labor not linked to a service']
  )
  assert.deepEqual(invoiceServiceLabels({ services: [], hasUnlinkedService: true }, translate), [
    'translated:Service not linked',
  ])
  assert.deepEqual(invoiceServiceLabels({ services: [] }, translate), [
    'translated:No service information',
  ])
})

test('invoice errors use translation keys instead of backend or network messages', () => {
  assert.equal(
    invoiceErrorMessage({ status: 401 }),
    'Your session has expired. Please sign in again.'
  )
  assert.equal(invoiceErrorMessage({ status: 403 }), 'You do not have permission to view invoices.')
  assert.equal(
    invoiceErrorMessage({ status: 422, message: 'Chi tiết lỗi từ máy chủ' }),
    'Check the invoice filters and try again.'
  )
  assert.equal(invoiceErrorMessage({ status: 400 }), 'Check the invoice filters and try again.')
  assert.equal(
    invoiceErrorMessage({ message: 'Không thể kết nối máy chủ.' }),
    'Unable to connect to the server. Please try again.'
  )
  assert.equal(
    invoiceErrorMessage({ status: 500, message: 'Internal database details' }),
    'Unable to load invoices. Please try again.'
  )
})
