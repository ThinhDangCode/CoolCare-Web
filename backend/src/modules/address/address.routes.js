import { Router } from 'express'
import { asyncHandler } from '../../utils.js'
import { authenticate } from '../../middleware/authenticate.js'

export function createAddressRouter(controller) {
  const router = Router()

  router.use(authenticate)

  // LOCATION

  // Get all provinces / cities
  router.get('/locations/provinces', asyncHandler(controller.getProvinces))

  // Get wards / communes by selected province
  router.get('/locations/provinces/:provinceCode/wards', asyncHandler(controller.getWards))

  // ADDRESS

  // View Address
  router.get('/', asyncHandler(controller.getAddresses))

  // Add New Address
  router.post('/', asyncHandler(controller.createAddress))

  // Edit Address
  router.put('/:id', asyncHandler(controller.updateAddress))

  // Delete Address
  router.delete('/:id', asyncHandler(controller.deleteAddress))

  // Set Default Address
  router.patch('/:id/default', asyncHandler(controller.setDefaultAddress))

  return router
}
