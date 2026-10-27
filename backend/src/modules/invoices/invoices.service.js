import { writeAdminAudit } from '../audit/admin-audit.js'
import { AppError, requireValidBody } from '../../utils.js'
import { validateInvoiceId, validateInvoiceListQuery } from './invoices.validation.js'
import { buildInvoicePdf } from './invoicePdf.js'

function pdfFilename(invoice) {
  const cleaned = String(invoice.invoiceNumber || invoice.id).normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]/gu, '-').replace(/-+/g, '-')
  const number = Array.from(cleaned).slice(0, 100).join('')
  return `Hoa-don-${number || invoice.id}.pdf`
}

export class InvoicesService {
  constructor(repository, { audit = writeAdminAudit, renderPdf = buildInvoicePdf } = {}) {
    this.repository = repository
    this.audit = audit
    this.renderPdf = renderPdf
  }

  async downloadInvoicePdf(id, actorId, query = {}) {
    const invoiceId = validateInvoiceId(id)
    requireValidBody(Object.fromEntries(Object.keys(query).map((key) =>
      [key, 'Tham số không được hỗ trợ khi tải hóa đơn PDF.'])))
    const invoice = await this.repository.getInvoice(invoiceId)
    if (!invoice) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.')
    let buffer
    try {
      buffer = await this.renderPdf(invoice)
      if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString('ascii') !== '%PDF-')
        throw new Error('Invalid PDF output')
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(500, 'INVOICE_PDF_FAILED', 'Không thể tạo hóa đơn PDF. Vui lòng thử lại.')
    }
    this.audit({
      actorId, action: 'EXPORT_PDF', entityType: 'INVOICE', entityId: invoice.id,
      before: null, after: { paymentStatus: invoice.paymentStatus, byteLength: buffer.length },
    })
    return { buffer, filename: pdfFilename(invoice) }
  }

  async getInvoice(id, actorId) {
    const invoice = await this.repository.getInvoice(validateInvoiceId(id))
    if (!invoice) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.')
    this.audit({
      actorId, action: 'READ_DETAIL', entityType: 'INVOICE', entityId: invoice.id,
      before: null, after: { paymentStatus: invoice.paymentStatus },
    })
    return invoice
  }

  async listInvoices(query, actorId) {
    const filters = validateInvoiceListQuery(query)
    const result = await this.repository.listInvoices(filters)
    this.audit({
      actorId, action: 'READ_LIST', entityType: 'INVOICE', entityId: null, before: null,
      after: {
        hasSearch: Boolean(filters.search), hasServiceFilter: filters.service !== 'ALL',
        status: filters.status, from: filters.from ?? null, to: filters.to ?? null,
        page: filters.page, limit: filters.limit, total: result.pagination.total, returned: result.items.length,
      },
    })
    return result
  }
}
