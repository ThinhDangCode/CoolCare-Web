export class SettlementController {
  constructor(service) {
    this.service = service
  }

  listWithdrawals = async (request, response) => {
    response.json({ data: await this.service.listWithdrawals(request.query) })
  }

  getWithdrawal = async (request, response) => {
    response.json({ data: await this.service.getWithdrawal(request.params.id) })
  }
}
