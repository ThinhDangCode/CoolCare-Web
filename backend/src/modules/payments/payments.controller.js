export class PaymentsController {
  constructor(service) {
    this.service = service
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
}
