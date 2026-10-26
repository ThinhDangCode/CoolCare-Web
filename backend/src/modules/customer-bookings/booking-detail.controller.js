import { BookingDetailService } from './booking-detail.service.js'
import { reconcileExpiredRequests } from './reconcile-technician-request.js'

export class BookingDetailController {
  constructor(service = new BookingDetailService()) {
    this.service = service
  }

  getDetail = async (req, res) => {
    await reconcileExpiredRequests()
    return res.status(200).json({
      data: await this.service.detail(req.auth?.userId, req.params.bookingId),
    })
  }

  reportNoShow = async (req, res) =>
    res.status(201).json({
      data: await this.service.reportNoShow(req.auth?.userId, req.params.bookingId, req.body),
    })

  getTimeline = async (req, res) =>
    res.status(200).json({
      data: await this.service.timeline(req.auth?.userId, req.params.bookingId),
    })

  confirmCompletion = async (req, res) =>
    res.status(200).json({
      data: await this.service.confirmCompletion(
        req.auth?.userId,
        req.params.bookingId,
      ),
    })

  cancel = async (req, res) =>
    res.status(200).json({
      data: await this.service.cancel(
        req.auth?.userId,
        req.params.bookingId,
        req.body,
      ),
    })
}