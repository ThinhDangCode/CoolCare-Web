export class TopupsController {
  constructor(service) {
    this.service = service
  }
  listTopups = async (request, response) => {
    const data = await this.service.listTopups(request.query, request.auth.userId)
    response.set('Cache-Control', 'no-store').json({ success: true, data })
  }
  getTopup = async (request, response) => {
    const data = await this.service.getTopup(request.params.id, request.auth.userId, request.query)
    response.set('Cache-Control', 'no-store').json({ success: true, data })
  }
}
