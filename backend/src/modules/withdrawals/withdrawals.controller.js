export class WithdrawalsController {
  constructor(service) {
    this.service = service
  }
  listWithdrawals = async (request, response) => {
    const data = await this.service.listWithdrawals(request.query, request.auth.userId)
    response.set('Cache-Control', 'no-store').json({ success: true, data })
  }
  getWithdrawal = async (request, response) => {
    const data = await this.service.getWithdrawal(
      request.params.id,
      request.auth.userId,
      request.query
    )
    response.set('Cache-Control', 'no-store').json({ success: true, data })
  }
}
