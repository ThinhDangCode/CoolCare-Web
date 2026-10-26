function pdfDownloadError(message, code, status) {
  const error = new Error(message)
  error.code = code
  if (status) error.status = status
  return error
}

function safeFilename(value) {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^[\p{L}\p{N}][\p{L}\p{N}._ -]*\.pdf$/iu.test(value) &&
    !value.includes('..') &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\.pdf$/i.test(value)
  )
}

export function invoicePdfFilename(disposition, invoiceNumber = '') {
  const invoicePart = String(invoiceNumber)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_-]/gu, '_')
    .slice(0, 80)
  const fallback = `CoolCare_Invoice_${invoicePart || 'invoice'}.pdf`
  if (typeof disposition !== 'string') return fallback
  const encoded = disposition.match(/\bfilename\*\s*=\s*UTF-8'[^']*'([^;\s]+)/i)
  if (encoded) {
    try {
      const filename = decodeURIComponent(encoded[1]).normalize('NFC')
      if (safeFilename(filename)) return filename
    } catch {
      // An invalid encoded name must not prevent downloading a valid PDF.
    }
  }
  const plain = disposition.match(/\bfilename\s*=\s*(?:"([^"]*)"|([^;\s]+))/i)
  const filename = plain && (plain[1] ?? plain[2]).normalize('NFC')
  return safeFilename(filename) ? filename : fallback
}

export async function requestInvoicePdf(url, token, signal, invoiceNumber) {
  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw pdfDownloadError(
      'Unable to connect to the server. Please try again.',
      'PDF_NETWORK_ERROR'
    )
  }
  if (!response.ok) {
    // Keep server details out of the UI, while preserving status for auth handling.
    throw pdfDownloadError(
      'Unable to download the invoice PDF. Please try again.',
      'PDF_REQUEST_FAILED',
      response.status
    )
  }
  if (
    response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf'
  ) {
    throw pdfDownloadError(
      'The server did not return a valid invoice PDF. Please try again.',
      'INVALID_PDF_RESPONSE'
    )
  }
  const blob = await response.blob()
  if (!blob.size || (await blob.slice(0, 5).text()) !== '%PDF-') {
    throw pdfDownloadError(
      'The server did not return a valid invoice PDF. Please try again.',
      'INVALID_PDF_RESPONSE'
    )
  }
  return {
    blob,
    filename: invoicePdfFilename(response.headers.get('Content-Disposition'), invoiceNumber),
  }
}

export function invoicePdfErrorMessage(error) {
  if (error.status === 401) return 'Your session has expired. Please sign in again.'
  if (error.status === 403) return 'You do not have permission to download invoice PDFs.'
  if (error.status === 404) return 'This invoice could not be found.'
  if ([400, 422].includes(error.status)) return 'The invoice PDF request is invalid.'
  if (error.status === 429) return 'Invoice PDF generation is busy. Please try again shortly.'
  if (error.code === 'PDF_NETWORK_ERROR')
    return 'Unable to connect to the server. Please try again.'
  if (error.code === 'INVALID_PDF_RESPONSE')
    return 'The server did not return a valid invoice PDF. Please try again.'
  return 'Unable to download the invoice PDF. Please try again.'
}

export function saveInvoicePdf(blob, filename) {
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = filename
  link.hidden = true
  try {
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    // Give the browser time to start reading the PDF before releasing its URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
