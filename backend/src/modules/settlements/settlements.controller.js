export class SettlementsController {
  constructor(service) { this.service = service }
  listSettlements = async (request, response) => {
    const data = await this.service.listSettlements(request.query, request.auth.userId)
    response.json({ success: true, data })
  }
  getSettlement = async (request, response) => {
    const data = await this.service.getSettlement(request.params.id, request.query, request.auth.userId)
    response.json({ success: true, data })
  }
}
