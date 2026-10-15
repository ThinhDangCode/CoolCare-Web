
import { MyBookingsService } from './my-bookings.service.js'

export class MyBookingsController {
  constructor(service = new MyBookingsService()) {
    this.service = service
  }

  /**
   * #41 - View My Bookings
   *
   * GET /api/bookings
   *
   * Query:
   * - status: optional
   * - page: optional
   * - limit: optional
   */
  getMyBookings = async (req, res, next) => {
    try {
      const result = await this.service.getMyBookings(
        req.auth?.userId,
        req.query
      )

      return res.status(200).json({
        data: result,
      })
    } catch (error) {
      next(error)
    }
  }
}
