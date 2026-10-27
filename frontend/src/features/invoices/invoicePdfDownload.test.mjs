import test from 'node:test'
import assert from 'node:assert/strict'
import {
  invoicePdfErrorMessage,
  invoicePdfFilename,
  requestInvoicePdf,
  saveInvoicePdf,
} from './invoicePdfDownload.js'

test('PDF filenames prefer safe RFC5987 Vietnamese names and fall back safely', () => {
  const unicode = 'CoolCare_Hóa đơn_HD-0002.pdf'
  assert.equal(
    invoicePdfFilename(
      `attachment; filename="invoice.pdf"; filename*=UTF-8''${encodeURIComponent(unicode)}`
    ),
    unicode
  )
  assert.equal(invoicePdfFilename('attachment; filename="HD-0002.pdf"'), 'HD-0002.pdf')
  assert.equal(
    invoicePdfFilename('attachment; filename*=UTF-8\'\'%bad; filename="invoice.pdf"'),
    'invoice.pdf'
  )
  for (const filename of [
    '../private.pdf',
    'C:\\private.pdf',
    'private..pdf',
    'invoice.html',
    'invoice.pdf.exe',
    'invoice\r\n.pdf',
    'invoice\u202E.pdf',
    'CON.pdf',
    `${'a'.repeat(130)}.pdf`,
  ]) {
    assert.equal(
      invoicePdfFilename(`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, 'HD-0002'),
      'CoolCare_Invoice_HD-0002.pdf'
    )
  }
  assert.equal(invoicePdfFilename(null, '../../<invalid>'), 'CoolCare_Invoice________invalid_.pdf')
})

test('PDF requests include admin bearer authorization, the PDF Accept header, and abort signal', async (context) => {
  const controller = new AbortController()
  let requested
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    requested = { url, options }
    return new Response('%PDF-1.7\ninvoice', {
      headers: {
        'Content-Type': 'application/pdf; charset=binary',
        'Content-Disposition': 'attachment; filename="HD-0002.pdf"',
      },
    })
  })
  const result = await requestInvoicePdf(
    '/api/admin/invoices/abc/pdf',
    'admin-token',
    controller.signal,
    'HD-0002'
  )
  assert.equal(requested.url, '/api/admin/invoices/abc/pdf')
  assert.equal(requested.options.method, 'GET')
  assert.equal(requested.options.signal, controller.signal)
  assert.deepEqual(requested.options.headers, {
    Authorization: 'Bearer admin-token',
    Accept: 'application/pdf',
  })
  assert.equal(result.filename, 'HD-0002.pdf')
  assert.equal(await result.blob.text(), '%PDF-1.7\ninvoice')
})

test('unsuccessful responses preserve status for session handling without displaying server details', async (context) => {
  for (const status of [401, 403, 404, 422, 429, 500]) {
    context.mock.method(
      globalThis,
      'fetch',
      async () => new Response('private server details', { status })
    )
    await assert.rejects(
      requestInvoicePdf('/api/admin/invoices/abc/pdf', 'token'),
      (error) => error.status === status && !error.message.includes('private')
    )
    context.mock.restoreAll()
  }
  assert.equal(
    invoicePdfErrorMessage({ status: 401 }),
    'Your session has expired. Please sign in again.'
  )
  assert.equal(
    invoicePdfErrorMessage({ status: 403 }),
    'You do not have permission to download invoice PDFs.'
  )
  assert.equal(invoicePdfErrorMessage({ status: 404 }), 'This invoice could not be found.')
  assert.equal(invoicePdfErrorMessage({ status: 422 }), 'The invoice PDF request is invalid.')
  assert.equal(
    invoicePdfErrorMessage({ status: 500, message: 'private' }),
    'Unable to download the invoice PDF. Please try again.'
  )
})

test('download rejects successful JSON, empty PDF, and HTML disguised as PDF', async (context) => {
  for (const [contentType, body] of [
    ['application/json', '{"data":{}}'],
    ['application/pdf', ''],
    ['application/pdf', '<html>login</html>'],
  ]) {
    context.mock.method(
      globalThis,
      'fetch',
      async () => new Response(body, { headers: { 'Content-Type': contentType } })
    )
    await assert.rejects(requestInvoicePdf('/api/admin/invoices/abc/pdf', 'token'), {
      code: 'INVALID_PDF_RESPONSE',
    })
    context.mock.restoreAll()
  }
})

test('abort remains cancellable and connection failures have a localizable message', async (context) => {
  const abort = new DOMException('Aborted', 'AbortError')
  context.mock.method(globalThis, 'fetch', async () => {
    throw abort
  })
  await assert.rejects(requestInvoicePdf('/pdf', 'token'), (error) => error === abort)
  context.mock.restoreAll()
  context.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('Network failed')
  })
  await assert.rejects(requestInvoicePdf('/pdf', 'token'), { code: 'PDF_NETWORK_ERROR' })
  assert.equal(
    invoicePdfErrorMessage({ code: 'PDF_NETWORK_ERROR' }),
    'Unable to connect to the server. Please try again.'
  )
})

test('browser download removes the link and releases the object URL after the browser can read it', (context) => {
  const events = []
  let delayedRevoke
  const link = { click: () => events.push('click'), remove: () => events.push('remove') }
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => link,
      body: { append: () => events.push('append') },
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: (callback, delay) => {
        delayedRevoke = callback
        assert.ok(delay >= 1000)
      },
    },
  })
  context.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else delete globalThis.document
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
  })
  context.mock.method(URL, 'createObjectURL', () => 'blob:invoice')
  context.mock.method(URL, 'revokeObjectURL', (url) => events.push(`revoke:${url}`))
  saveInvoicePdf(new Blob(['%PDF-1.7']), 'HD-0002.pdf')
  assert.equal(link.href, 'blob:invoice')
  assert.equal(link.download, 'HD-0002.pdf')
  assert.deepEqual(events, ['append', 'click', 'remove'])
  delayedRevoke()
  assert.deepEqual(events, ['append', 'click', 'remove', 'revoke:blob:invoice'])
})
