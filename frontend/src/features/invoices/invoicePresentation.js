import { safePdfUrl } from '../payments/paymentPresentation.js'
import { readInvoiceFilters, writeInvoiceFilters } from './invoiceFilters.js'

export const invoicePdfUrl = safePdfUrl
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const validInvoiceId = (value) => uuid.test(value ?? '')

function formatDecimal(value, locale, maximumFractionDigits, minimumFractionDigits = 0) {
  if (value === null || value === undefined) return '—'
  const text = String(value)
  if (!new RegExp(`^-?\\d+(?:\\.\\d{1,${maximumFractionDigits}})?$`).test(text)) return '—'
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  const language = locale === 'vi' ? 'vi-VN' : 'en-US'
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 0 })
  const separator = new Intl.NumberFormat(language)
    .formatToParts(1.1)
    .find((part) => part.type === 'decimal').value
  const significantFraction = fraction.replace(/0+$/, '')
  const decimals = significantFraction ? significantFraction.padEnd(minimumFractionDigits, '0') : ''
  return `${text.startsWith('-') ? '-' : ''}${number.format(BigInt(whole))}${decimals ? `${separator}${decimals}` : ''}`
}

export function formatInvoiceAmount(value, locale = 'en') {
  const decimal = formatDecimal(value, locale, 2, 2)
  if (decimal === '—') return decimal
  return `${decimal} ₫`
}

export function formatInvoiceQuantity(value, locale = 'en') {
  return formatDecimal(value, locale, 3)
}

export function invoiceListUrl(search = '') {
  const query = writeInvoiceFilters(readInvoiceFilters(new URLSearchParams(search))).toString()
  return `/admin/invoices${query ? `?${query}` : ''}`
}

export function invoiceDetailUrl(id, search = '') {
  if (!validInvoiceId(id)) return null
  const query = invoiceListUrl(search).split('?')[1]
  return `/admin/invoices/${id}${query ? `?${query}` : ''}`
}

export function invoiceDetailErrorMessage(error) {
  if (error.status === 401) return 'Your session has expired. Please sign in again.'
  if (error.status === 403) return 'You do not have permission to view invoices.'
  if (error.status === 400 || error.status === 422) return 'The invoice ID is invalid.'
  if (error.status === 404) return 'This invoice could not be found.'
  if (!error.status) return 'Unable to connect to the server. Please try again.'
  return 'Unable to load invoice details. Please try again.'
}

export function invoiceErrorMessage(error) {
  if (error.status === 401) return 'Your session has expired. Please sign in again.'
  if (error.status === 403) return 'You do not have permission to view invoices.'
  if (error.status === 400 || error.status === 422)
    return 'Check the invoice filters and try again.'
  if (!error.status) return 'Unable to connect to the server. Please try again.'
  return 'Unable to load invoices. Please try again.'
}

const issuedDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

export function formatInvoiceDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? issuedDate.format(date) : '—'
}

export function formatInvoiceTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function invoiceServiceLabels(invoice, t = (key) => key) {
  const services = (invoice.services ?? []).map((service) => service.name?.trim()).filter(Boolean)
  if (invoice.hasUnlinkedService) services.push(t('Service not linked'))
  if (invoice.hasUnlinkedLabor) services.push(t('Additional labor not linked to a service'))
  return services.length ? services : [t('No service information')]
}
