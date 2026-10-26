import { env } from '../../config/env.js'
import { AppError } from '../../utils.js'
import { InvoiceRepository } from './invoice.repository.js'
import { renderInvoicePdf } from './invoice.pdf.js'
import {
  invoiceFilename,
  maskEmail,
  maskPhone,
  paymentMethodLabel,
  paymentStatusLabel,
} from './invoice.format.js'

const NOTES_LIMIT = 500
const EMAIL_WINDOW_MS = 15 * 60_000
const EMAIL_MAX_PER_WINDOW = 3
const FAILURE_BACKOFF_MS = 10 * 60_000

const money = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const joinAddress = (row) =>
  [row.serviceAddress, row.ward, row.district, row.city]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(', ')

// Pure: turns the repository rows into the document shown in the app and the PDF.
export function buildInvoiceView({ payment, invoice, items, paidAmount }, company = env.company) {
  const total = money(invoice.totalAmount)
  const paid = Math.min(money(paidAmount), total)
  const notes = String(payment.bookingDescription ?? '').trim().slice(0, NOTES_LIMIT)
  return {
    paymentId: payment.paymentId,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt,
    booking: {
      id: payment.bookingId,
      code: payment.bookingCode,
      serviceDate: payment.completedAt ?? payment.scheduledAt,
      technicianName: payment.technicianName ?? null,
    },
    provider: {
      name: company.name || 'CoolCare',
      address: company.address || null,
      hotline: company.hotline || null,
      taxCode: company.taxCode || null,
    },
    customer: {
      name: payment.customerName,
      phoneMasked: maskPhone(payment.customerPhone),
      address: joinAddress(payment),
      emailMasked: maskEmail(payment.customerEmail),
    },
    payment: {
      code: payment.paymentCode,
      status: payment.status,
      statusLabel: paymentStatusLabel(payment.status),
      methodCode: payment.methodCode,
      methodLabel: paymentMethodLabel(payment.methodCode),
      paidAt: payment.paidAt,
    },
    items: items.map((item) => ({
      id: item.id,
      type: item.itemType,
      description: String(item.description ?? '').trim() || '—',
      quantity: money(item.quantity) || 1,
      unit: item.unit ?? null,
      unitPrice: money(item.unitPrice),
      totalPrice: money(item.totalPrice),
    })),
    partsAmount: money(invoice.partsAmount),
    subtotal: money(invoice.subtotal),
    discountAmount: money(invoice.discountAmount),
    totalAmount: total,
    paidAmount: paid,
    remainingAmount: Math.max(total - paid, 0),
    notes,
  }
}

export class InvoiceService {
  constructor({ repository = new InvoiceRepository(), emailSender, now = () => Date.now(), logger = console } = {}) {
    this.repository = repository
    this.emailSender = emailSender
    this.now = now
    this.logger = logger
    this.sendLog = new Map()
    this.failures = new Map()
    this.dispatching = false
    this.rerun = false
  }

  async #load(userId, paymentId) {
    let found = await this.repository.findForCustomer(userId, paymentId)
    if (found?.payment.status === 'SUCCESS' && !found.invoice) {
      // Paid but never invoiced (nothing else creates invoices): issue it now.
      await this.repository.ensureInvoice(paymentId)
      found = await this.repository.findForCustomer(userId, paymentId)
    }
    if (!found) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Không tìm thấy giao dịch thanh toán.')
    if (found.payment.status !== 'SUCCESS') {
      throw new AppError(409, 'INVOICE_NOT_AVAILABLE', 'Hóa đơn chỉ khả dụng sau khi thanh toán thành công.')
    }
    if (!found.invoice) {
      throw new AppError(404, 'INVOICE_NOT_FOUND', 'Hóa đơn của giao dịch này chưa được phát hành.')
    }
    return found
  }

  async getInvoice(userId, paymentId) {
    return buildInvoiceView(await this.#load(userId, paymentId))
  }

  async getPdf(userId, paymentId) {
    const invoice = await this.getInvoice(userId, paymentId)
    return { invoice, buffer: renderInvoicePdf(invoice), filename: invoiceFilename(invoice.invoiceNumber) }
  }

  #requireSender() {
    if (!this.emailSender?.isConfigured) {
      throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Gửi email chưa được cấu hình. Vui lòng thử lại sau.')
    }
  }

  #checkRateLimit(userId) {
    const now = this.now()
    const recent = (this.sendLog.get(userId) ?? []).filter((at) => now - at < EMAIL_WINDOW_MS)
    if (recent.length >= EMAIL_MAX_PER_WINDOW) {
      const retryAfter = Math.ceil((EMAIL_WINDOW_MS - (now - recent[0])) / 1000)
      throw new AppError(429, 'INVOICE_EMAIL_RATE_LIMITED', 'Bạn gửi email hóa đơn quá nhiều lần. Vui lòng thử lại sau ít phút.', { retryAfter })
    }
    this.sendLog.set(userId, [...recent, now])
  }

  async #deliver(found) {
    const email = String(found.payment.customerEmail ?? '').trim()
    if (!email) throw new AppError(422, 'EMAIL_REQUIRED', 'Tài khoản chưa có email để nhận hóa đơn.')
    const invoice = buildInvoiceView(found)
    await this.emailSender.sendInvoiceEmail({
      email,
      name: invoice.customer.name,
      invoice,
      pdf: renderInvoicePdf(invoice),
      filename: invoiceFilename(invoice.invoiceNumber),
    })
    this.logger.info?.(`[invoice-email] sent ${invoice.invoiceNumber} (booking ${invoice.booking.code}) to ${maskEmail(email)}`)
    this.logger.info?.(`[invoice-email] sent invoice ${invoice.invoiceNumber} (payment ${found.payment.paymentId}) to ${maskEmail(email)}`)
    return { invoice, email }
  }

  // Customer pressed "Send to my email".
  async emailInvoice(userId, paymentId) {
    this.#requireSender()
    const found = await this.#load(userId, paymentId)
    this.#checkRateLimit(userId)
    const { invoice, email } = await this.#deliver(found)
    await this.#record(userId, found, invoice)
    return { sentTo: maskEmail(email), invoiceNumber: invoice.invoiceNumber }
  }

  async #record(userId, found, invoice) {
    try {
      await this.repository.recordEmailSent({ userId, bookingId: found.payment.bookingId, invoiceNumber: invoice.invoiceNumber })
    } catch (error) {
      this.logger.error('Invoice email was sent but could not be recorded', error)
    }
  }

  // Sends the invoice automatically once a payment has succeeded. Safe to call
  // often: finished sends are recorded as notifications and skipped next time.
  async dispatchPendingEmails({ limit = 10 } = {}) {
    if (!this.emailSender?.isConfigured) {
      if (!this.warnedNoSmtp) {
        this.warnedNoSmtp = true
        this.logger.warn?.('[invoice-email] SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD); invoices will not be emailed automatically')
      }
      return 0
    }
    if (this.dispatching) { this.rerun = true; return 0 }
    this.dispatching = true
    let sent = 0
    try {
      do {
        this.rerun = false
        const targets = await this.repository.findPendingEmails(limit)
        if (targets.length) this.logger.info?.(`[invoice-email] ${targets.length} invoice(s) pending`)
        for (const target of targets) {
          const failedAt = this.failures.get(target.paymentId)
          if (failedAt !== undefined && this.now() - failedAt < FAILURE_BACKOFF_MS) continue
          try {
            const found = await this.#load(target.userId, target.paymentId)
            const { invoice } = await this.#deliver(found)
            await this.#record(target.userId, found, invoice)
            this.failures.delete(target.paymentId)
            sent += 1
          } catch (error) {
            this.failures.set(target.paymentId, this.now())
            this.logger.error(`[invoice-email] failed for payment ${target.paymentId}: ${error?.message ?? error}; retry in ${FAILURE_BACKOFF_MS / 60_000} min`)
          }
        }
        // A failed target stays pending; avoid hot-looping on it within one run.
        if (sent === 0) break
      } while (this.rerun)
    } finally {
      this.dispatching = false
    }
    return sent
  }
}
