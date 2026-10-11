import { validateAddressInput } from './address.validation.js'

export class AddressController {
  constructor(service) {
    this.service = service
  }

  // LOCATION

  // Get all provinces / cities
  getProvinces = async (_request, response) => {
    const provinces = await this.service.getProvinces()

    response.json({
      data: provinces,
    })
  }

  // Get wards / communes by province
  getWards = async (request, response) => {
    const wards = await this.service.getWards(request.params.provinceCode)

    response.json({
      data: wards,
    })
  }

  // ADDRESS

  // View Address
  getAddresses = async (request, response) => {
    const addresses = await this.service.getAddresses(request.auth)

    response.json({
      data: addresses,
    })
  }

  // Add New Address
  createAddress = async (request, response) => {
    const input = validateAddressInput(request.body)

    const address = await this.service.createAddress(request.auth, input)

    response.status(201).json({
      data: address,
    })
  }

  // Edit Address
  updateAddress = async (request, response) => {
    const input = validateAddressInput(request.body)

    const address = await this.service.updateAddress(request.auth, request.params.id, input)

    response.json({
      data: address,
    })
  }

  // Delete Address
  deleteAddress = async (request, response) => {
    await this.service.deleteAddress(request.auth, request.params.id)

    response.status(204).send()
  }

  // Set Default Address
  setDefaultAddress = async (request, response) => {
    const address = await this.service.setDefaultAddress(request.auth, request.params.id)

    response.json({
      data: address,
    })
  }
}
