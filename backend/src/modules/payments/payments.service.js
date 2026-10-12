import { writeManagementAudit } from '../management/management.audit.js'
import { AppError } from '../../utils.js'
import { validatePaymentId, validatePaymentListQuery } from './payments.validation.js'

export class PaymentsService {
  constructor(repository, { audit = writeManagementAudit } = {}) {
    this.repository = repository
    this.audit = audit
  }

  async listPayments(query, actorId) {
    const filters = validatePaymentListQuery(query)
    const result = await this.repository.listPayments(filters)
    this.audit({
      actorId,
      action: 'READ_LIST',
      entityType: 'PAYMENT',
      entityId: null,
      before: null,
      after: {
        hasSearch: Boolean(filters.search),
        status: filters.status,
        method: filters.method,
        from: filters.from ?? null,
        to: filters.to ?? null,
        page: filters.page,
        limit: filters.limit,
        total: result.pagination.total,
        returned: result.items.length,
      },
    })
    return result
  }

  async getPayment(id, actorId) {
    const payment = await this.repository.getPayment(validatePaymentId(id))
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Không tìm thấy thanh toán.')
    // Return only stored, absolute web links; never turn missing PDFs into fake downloads.
    if (payment.invoice) {
      const storedUrl = payment.invoice.pdfUrl
      payment.invoice.pdfUrl = null
      try {
        if (typeof storedUrl === 'string' && storedUrl.trim()) {
          const url = new URL(storedUrl)
          if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
            payment.invoice.pdfUrl = storedUrl.trim()
          }
        }
      } catch { /* Malformed or non-web links remain unavailable. */ }
    }
    this.audit({
      actorId,
      action: 'READ_DETAIL',
      entityType: 'PAYMENT',
      entityId: payment.id,
      before: null,
      after: { bookingId: payment.booking.id, status: payment.status },
    })
    return payment
  }
}
