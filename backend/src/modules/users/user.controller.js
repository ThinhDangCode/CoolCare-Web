import { validateUserId, validateUserListQuery, validateUserStatus } from './user.validation.js'

export class UserController {
  constructor(service) {
    this.service = service
  }
  list = async (request, response) =>
    response.json({ data: await this.service.list(validateUserListQuery(request.query)) })
  changeStatus = async (request, response) =>
    response.json({
      data: await this.service.changeStatus(
        validateUserId(request.params.id),
        validateUserStatus(request.body),
        request.auth.userId
      ),
    })
}
