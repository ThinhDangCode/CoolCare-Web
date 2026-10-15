export class RevenueController {
  constructor(service) {
    this.service = service
  }
  getRevenueReport = async (request, response) => {
    const data = await this.service.getRevenueReport(request.query, request.auth.userId)
    response.set('Cache-Control', 'no-store').json({ success: true, data })
  }
}
