export class PaymentsController {
  constructor(service, exportService) {
    this.service = service
    this.exportService = exportService
  }

  listPayments = async (request, response) => {
    const data = await this.service.listPayments(request.query, request.auth.userId)
    response.set('Cache-Control', 'no-store').json({
      success: true,
      data,
    })
  }

  getPayment = async (request, response) => {
    const data = await this.service.getPayment(request.params.id, request.auth.userId)
    response.set('Cache-Control', 'no-store').json({ success: true, data })
  }

  exportRevenue = async (request, response) => {
    const report = await this.exportService.exportRevenue(request.query, request.auth.userId)
    response.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${report.filename}"`,
      'Cache-Control': 'no-store',
      'X-Report-Row-Count': String(report.rowCount),
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Report-Row-Count',
    }).send(report.buffer)
  }
}
