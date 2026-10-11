import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { ManagementRepository } from './management.repository.js'
import {
  validateBlogInput,
  validateBlogStatus,
  validateComplaintResolution,
  validateManagementListQuery,
  validateUserStatus,
  validateUuid,
  validateVoucherInput,
  validateVoucherStatus,
} from './management.validation.js'

export function createManagementRouter(repository = new ManagementRepository()) {
  const router = Router()
  router.use(authenticate, requireRole('ADMIN'))
  router.get(
    '/users',
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.listUsers(validateManagementListQuery(req.query, 'users')),
      })
    )
  )
  router.patch(
    '/users/:id/status',
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.changeUserStatus(
          validateUuid(req.params.id),
          validateUserStatus(req.body),
          req.auth.userId
        ),
      })
    )
  )
  router.get(
    '/vouchers',
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.listVouchers(validateManagementListQuery(req.query, 'vouchers')),
      })
    )
  )
  router.post(
    '/vouchers',
    asyncHandler(async (req, res) =>
      res.status(201).json({
        data: await repository.mutateVoucher(
          null,
          validateVoucherInput(req.body),
          req.auth.userId,
          'CREATE_VOUCHER'
        ),
      })
    )
  )
  router.patch(
    '/vouchers/:id',
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.mutateVoucher(
          validateUuid(req.params.id),
          validateVoucherInput(req.body, true),
          req.auth.userId,
          'UPDATE_VOUCHER'
        ),
      })
    )
  )
  router.patch(
    '/vouchers/:id/status',
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.mutateVoucher(
          validateUuid(req.params.id),
          { is_active: validateVoucherStatus(req.body) },
          req.auth.userId,
          'TOGGLE_VOUCHER_STATUS'
        ),
      })
    )
  )
  router.get(
    '/voucher-usages',
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.listVoucherUsages(validateManagementListQuery(req.query, 'usages')),
      })
    )
  )
  router.get(
    '/blogs',
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.listBlogs(validateManagementListQuery(req.query, 'blogs')),
      })
    )
  )
  router.get(
    '/blogs/:id',
    asyncHandler(async (req, res) =>
      res.json({ data: await repository.getBlog(validateUuid(req.params.id)) })
    )
  )
  router.post(
    '/blogs',
    asyncHandler(async (req, res) =>
      res.status(201).json({
        data: await repository.mutateBlog(
          null,
          validateBlogInput(req.body),
          req.auth.userId,
          'CREATE_BLOG'
        ),
      })
    )
  )
  router.patch(
    '/blogs/:id',
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.mutateBlog(
          validateUuid(req.params.id),
          validateBlogInput(req.body, true),
          req.auth.userId,
          'UPDATE_BLOG'
        ),
      })
    )
  )
  router.patch(
    '/blogs/:id/status',
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.mutateBlog(
          validateUuid(req.params.id),
          { status: validateBlogStatus(req.body) },
          req.auth.userId,
          'TOGGLE_BLOG_STATUS'
        ),
      })
    )
  )
  router.get(
    '/complaints',
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.listComplaints(validateManagementListQuery(req.query, 'complaints')),
      })
    )
  )
  router.get(
    '/complaints/:id',
    asyncHandler(async (req, res) =>
      res.json({ data: await repository.getComplaint(validateUuid(req.params.id)) })
    )
  )
  router.patch(
    '/complaints/:id/resolve',
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.resolveComplaint(
          validateUuid(req.params.id),
          validateComplaintResolution(req.body),
          req.auth.userId
        ),
      })
    )
  )
  return router
}
