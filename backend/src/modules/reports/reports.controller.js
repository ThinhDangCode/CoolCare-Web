export class ReportsController {
  constructor(service) {
    this.service = service
  }

  getReports = async (request, response) => {
    const data = await this.service.getReports(request.query, request.auth.userId)
    response.json({ success: true, data })
  }
}
