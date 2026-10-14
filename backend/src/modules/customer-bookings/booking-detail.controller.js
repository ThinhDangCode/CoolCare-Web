import { BookingDetailService } from './booking-detail.service.js'

export class BookingDetailController {
  constructor(service = new BookingDetailService()) { this.service = service }
  getDetail = async (req, res) => res.status(200).json({ data: await this.service.detail(req.auth?.userId, req.params.bookingId) })
  getTimeline = async (req, res) => res.status(200).json({ data: await this.service.timeline(req.auth?.userId, req.params.bookingId) })
  cancel = async (req, res) => res.status(200).json({ data: await this.service.cancel(req.auth?.userId, req.params.bookingId, req.body) })
}
