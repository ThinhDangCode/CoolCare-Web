import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler, AppError } from '../../utils.js'
import { CatalogRepository } from './catalog.repository.js'
import { resources, validateId, validateInput, validateQuery } from './catalog.validation.js'

export function createCatalogRouter(repository = new CatalogRepository(), admin = true) {
  const router = Router()
  // The mobile catalog is public and read-only. Admin mutations remain
  // protected by authentication and the ADMIN role.
  if (admin) router.use(authenticate, requireRole('ADMIN'))
  for (const kind of Object.keys(resources)) {
    router.get(
      `/${kind}`,
      asyncHandler(async (req, res) =>
        res.json({ data: await repository.list(kind, validateQuery(req.query, kind), !admin) })
      )
    )
    router.get(
      `/${kind}/:id`,
      asyncHandler(async (req, res) =>
        res.json({ data: await repository.find(kind, validateId(req.params.id), !admin) })
      )
    )
    if (!admin) continue
    router.post(
      `/${kind}`,
      asyncHandler(async (req, res) =>
        res.status(201).json({
          data: await repository.mutate(
            kind,
            null,
            validateInput(kind, req.body),
            'CREATE',
            req.auth.userId
          ),
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
            'UPDATE',
            req.auth.userId
          ),
        })
      )
    )
    if (kind === 'services' || kind === 'models' || kind === 'skills')
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
              'TOGGLE',
              req.auth.userId
            ),
          })
        })
      )
    router.delete(`/${kind}/:id`, asyncHandler(async (req,res) => {
      await repository.mutate(kind,validateId(req.params.id),{},'TRASH',req.auth.userId)
      res.sendStatus(204)
    }))
    router.patch(`/${kind}/:id/restore`, asyncHandler(async (req,res) => {
      res.json({data:await repository.mutate(kind,validateId(req.params.id),{},'RESTORE',req.auth.userId)})
    }))

  }
  return router
}
