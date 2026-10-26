import { adminRequest } from '../../../shared/api/adminApi.js'
import { requestInvoicePdf } from '../invoicePdfDownload.js'

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

export function listInvoices(query, token, signal) {
  return adminRequest(`/invoices?${query}`, token, { signal })
}

export function getInvoice(id, token, signal) {
  return adminRequest(`/invoices/${encodeURIComponent(id)}`, token, { signal })
}

export function downloadInvoicePdf(id, token, signal, invoiceNumber) {
  return requestInvoicePdf(
    `${apiBase}/admin/invoices/${encodeURIComponent(id)}/pdf`,
    token,
    signal,
    invoiceNumber
  )
}
