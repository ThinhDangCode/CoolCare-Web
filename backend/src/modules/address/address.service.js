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
    const provinces = await this.repository.getProvinces()
    return provinces.filter((p) => /cần\s*thơ|can\s*tho/i.test(p.name.normalize('NFC')))
  }

  async getWards(provinceCode) {
    if (!provinceCode) {
      throw new AppError(400, 'PROVINCE_CODE_REQUIRED', 'Province code is required.')
    }

    const provinces = await this.getProvinces()
    if (!provinces.some((p) => String(p.code) === String(provinceCode))) {
      throw new AppError(400, 'OUTSIDE_SERVICE_AREA', 'Chỉ hỗ trợ địa chỉ tại Cần Thơ.')
    }
    const wards = await this.repository.getWards(provinceCode)

    if (!wards) {
      throw new AppError(404, 'PROVINCE_NOT_FOUND', 'Province not found.')
    }

    return wards
  }

  ensureCanTho(input) {
    const city = String(input.city ?? '').normalize('NFC').trim()
      .replace(/^(?:thành phố|tp\.?)\s*/iu, '')
    if (!/^(?:cần\s*thơ|can\s*tho)$/iu.test(city)) {
      throw new AppError(400, 'OUTSIDE_SERVICE_AREA', 'Chỉ hỗ trợ địa chỉ tại Cần Thơ.')
    }
  }

  // ADDRESS

  async getAddresses(auth) {
    const customerId = await this.getCustomerId(auth)

    return this.repository.findAllByCustomerId(customerId)
  }

  async createAddress(auth, input) {
    const customerId = await this.getCustomerId(auth)

    this.ensureCanTho(input)
    return this.repository.create(customerId, input)
  }

  async updateAddress(auth, addressId, input) {
    const customerId = await this.getCustomerId(auth)

    this.ensureCanTho(input)
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
