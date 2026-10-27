export function invoicePdfContentDisposition(filename) {
  const ascii = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\x20-\x7e]/g, '-')
  const encoded = encodeURIComponent(filename).replace(/['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

export class InvoicesController {
  constructor(service) { this.service = service }
  downloadInvoicePdf = async (request, response) => {
    const document = await this.service.downloadInvoicePdf(request.params.id, request.auth.userId, request.query)
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': invoicePdfContentDisposition(document.filename),
      'Content-Length': String(document.buffer.length),
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    })
    response.send(document.buffer)
  }

  getInvoice = async (request, response) => {
    const data = await this.service.getInvoice(request.params.id, request.auth.userId)
    response.json({ success: true, data })
  }

  listInvoices = async (request, response) => {
    const data = await this.service.listInvoices(request.query, request.auth.userId)
    response.json({ success: true, data })
  }
}
