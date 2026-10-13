import {
  validateAdminBlogQuery,
  validateBlogId,
  validateBlogInput,
  validateBlogStatus,
  validatePublishedBlogQuery,
} from './blog.validation.js'

export class BlogController {
  constructor(service) {
    this.service = service
  }

  listPublished = async (request, response) =>
    response.json({
      data: await this.service.listPublished(validatePublishedBlogQuery(request.query)),
    })

  getPublished = async (request, response) =>
    response.json({ data: await this.service.getPublished(validateBlogId(request.params.id)) })

  listAdmin = async (request, response) =>
    response.json({ data: await this.service.listAdmin(validateAdminBlogQuery(request.query)) })
  getAdmin = async (request, response) =>
    response.json({ data: await this.service.getAdmin(validateBlogId(request.params.id)) })
  create = async (request, response) =>
    response.status(201).json({
      data: await this.service.create(validateBlogInput(request.body), request.auth.userId),
    })
  update = async (request, response) =>
    response.json({
      data: await this.service.update(
        validateBlogId(request.params.id),
        validateBlogInput(request.body, true),
        request.auth.userId
      ),
    })
  changeStatus = async (request, response) =>
    response.json({
      data: await this.service.changeStatus(
        validateBlogId(request.params.id),
        validateBlogStatus(request.body),
        request.auth.userId
      ),
    })
}
