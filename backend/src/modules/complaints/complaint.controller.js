import {
  validateCompensationVoucher,
  validateComplaintId,
  validateComplaintListQuery,
  validateComplaintResolution,
  validateComplaintSubmission,
  validateCustomerComplaintQuery,
} from './complaint.validation.js'

export class ComplaintController {
  constructor(service) {
    this.service = service
  }
  list = async (request, response) =>
    response.json({ data: await this.service.list(validateComplaintListQuery(request.query)) })
  get = async (request, response) =>
    response.json({ data: await this.service.get(validateComplaintId(request.params.id)) })
  resolve = async (request, response) =>
    response.json({
      data: await this.service.resolve(
        validateComplaintId(request.params.id),
        validateComplaintResolution(request.body),
        request.auth.userId
      ),
    })
  createCompensationVoucher = async (request, response) =>
    response
      .status(201)
      .json({
        data: await this.service.createCompensationVoucher(
          validateComplaintId(request.params.id),
          validateCompensationVoucher(request.body),
          request.auth.userId
        ),
      })

  listMine = async (request, response) =>
    response.json({
      data: await this.service.listMine(
        request.auth.userId,
        validateCustomerComplaintQuery(request.query)
      ),
    })

  getMine = async (request, response) =>
    response.json({
      data: await this.service.getMine(request.auth.userId, validateComplaintId(request.params.id)),
    })

  submit = async (request, response) =>
    response.status(201).json({
      data: await this.service.submit(
        request.auth.userId,
        validateComplaintSubmission(request.body)
      ),
    })
}
