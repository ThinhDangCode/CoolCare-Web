import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler, AppError } from '../../utils.js'
import { CatalogRepository } from './catalog.repository.js'
import { resources, validateId, validateInput, validateQuery } from './catalog.validation.js'

export function createCatalogRouter(repository = new CatalogRepository(), admin = true) {
  const router = Router()
  router.use(authenticate)
  if (admin) router.use(requireRole('ADMIN'))
  for (const kind of Object.keys(resources)) {
    router.get(
      `/${kind}`,
      asyncHandler(async (req, res) =>
        res.json({ data: await repository.list(kind, validateQuery(req.query, kind), !admin) })
      )
    )
    if (!admin) continue
    router.post(
      `/${kind}`,
      asyncHandler(async (req, res) =>
        res.status(201).json({
          data: await repository.mutate(kind, null, validateInput(kind, req.body), 'CREATE'),
        })
      )
    )
    router.patch(
      `/${kind}/:id`,
      asyncHandler(async (req, res) =>
        res.json({
          data: await repository.mutate(
            kind,
            validateId(req.params.id),
            validateInput(kind, req.body, true),
            'UPDATE'
          ),
        })
      )
    )
    if (kind === 'services' || kind === 'models')
      router.patch(
        `/${kind}/:id/status`,
        asyncHandler(async (req, res) => {
          if (
            !req.body ||
            Object.keys(req.body).length !== 1 ||
            typeof req.body.is_active !== 'boolean'
          )
            throw new AppError(422, 'VALIDATION_ERROR', 'Vui lòng gửi is_active dạng boolean.')
          res.json({
            data: await repository.mutate(
              kind,
              validateId(req.params.id),
              { is_active: req.body.is_active },
              'TOGGLE'
            ),
          })
        })
      )
    if (kind === 'categories')
      router.delete(
        `/${kind}/:id`,
        asyncHandler(async (req, res) => {
          await repository.mutate(kind, validateId(req.params.id), {}, 'DELETE')
          res.sendStatus(204)
        })
      )
  }
  return router
}
