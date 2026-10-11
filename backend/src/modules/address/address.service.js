import { AppError } from '../../utils.js'

export class AddressService {
  constructor(repository) {
    this.repository = repository
  }

  ensureCustomer(auth) {
    if (!auth?.userId) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.')
    }

    if (auth.role !== 'CUSTOMER') {
      throw new AppError(403, 'FORBIDDEN', 'Only customers can manage addresses.')
    }
  }

  async getCustomerId(auth) {
    this.ensureCustomer(auth)

    const customer = await this.repository.findCustomerProfileByUserId(auth.userId)

    if (!customer) {
      throw new AppError(404, 'CUSTOMER_PROFILE_NOT_FOUND', 'Customer profile not found.')
    }

    return customer.id
  }

  // LOCATION

  async getProvinces() {
    return this.repository.getProvinces()
  }

  async getWards(provinceCode) {
    if (!provinceCode) {
      throw new AppError(400, 'PROVINCE_CODE_REQUIRED', 'Province code is required.')
    }

    const wards = await this.repository.getWards(provinceCode)

    if (!wards) {
      throw new AppError(404, 'PROVINCE_NOT_FOUND', 'Province not found.')
    }

    return wards
  }

  // ADDRESS

  async getAddresses(auth) {
    const customerId = await this.getCustomerId(auth)

    return this.repository.findAllByCustomerId(customerId)
  }

  async createAddress(auth, input) {
    const customerId = await this.getCustomerId(auth)

    return this.repository.create(customerId, input)
  }

  async updateAddress(auth, addressId, input) {
    const customerId = await this.getCustomerId(auth)

    const address = await this.repository.update(addressId, customerId, input)

    if (!address) {
      throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found.')
    }

    return address
  }

  async deleteAddress(auth, addressId) {
    const customerId = await this.getCustomerId(auth)

    const address = await this.repository.delete(addressId, customerId)

    if (!address) {
      throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found.')
    }

    return address
  }

  async setDefaultAddress(auth, addressId) {
    const customerId = await this.getCustomerId(auth)

    const address = await this.repository.setDefault(addressId, customerId)

    if (!address) {
      throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found.')
    }

    return address
  }
}
