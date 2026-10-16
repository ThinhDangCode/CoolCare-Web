import {
  validateVoucherBookingId,
  validateVoucherCode,
  validateVoucherId,
  validateVoucherInput,
  validateVoucherListQuery,
  validateVoucherStatus,
} from './voucher.validation.js'

export class VoucherController {
  constructor(service) {
    this.service = service
  }

  available = async (request, response) =>
    response.json({ data: await this.service.available(
      request.auth.userId, validateVoucherBookingId(request.params.id)
    ) })
  apply = async (request, response) =>
    response.json({
      data: await this.service.apply(
        request.auth.userId,
        validateVoucherBookingId(request.params.id),
        validateVoucherCode(request.body)
      ),
    })
  list = async (request, response) =>
    response.json({ data: await this.service.list(validateVoucherListQuery(request.query)) })
  create = async (request, response) =>
    response.status(201).json({
      data: await this.service.create(validateVoucherInput(request.body), request.auth.userId),
    })
  update = async (request, response) =>
    response.json({
      data: await this.service.update(
        validateVoucherId(request.params.id),
        validateVoucherInput(request.body, true),
        request.auth.userId
      ),
    })
  changeStatus = async (request, response) =>
    response.json({
      data: await this.service.changeStatus(
        validateVoucherId(request.params.id),
        validateVoucherStatus(request.body),
        request.auth.userId
      ),
    })
  listUsages = async (request, response) =>
    response.json({
      data: await this.service.listUsages(validateVoucherListQuery(request.query, true)),
    })
}
