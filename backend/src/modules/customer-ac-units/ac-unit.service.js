import { AppError, validateUuid } from '../../utils.js'
import { CustomerAcUnitRepository } from './ac-unit.repository.js'
import { validateAcHistoryQuery } from './ac-unit.validation.js'

const asNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const text = (value) => {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

export class CustomerAcUnitService {
  constructor(repository = new CustomerAcUnitRepository()) {
    this.repository = repository
  }

  async listUnits(userId) {
    const rows = await this.repository.listGroups(validateUuid(userId))
    return {
      items: rows.map((row) => ({
        brandId: row.brandId ?? null,
        modelId: row.modelId ?? null,
        brandName: text(row.brandName),
        modelName: text(row.modelName),
        capacityBtu: row.capacityBtu == null ? null : asNumber(row.capacityBtu),
        serviceCount: asNumber(row.serviceCount),
        completedCount: asNumber(row.completedCount),
        lastServiceAt: row.lastServiceAt ?? null,
      })),
      matchBasis: 'BRAND_AND_MODEL',
    }
  }

  async getHistory(userId, query) {
    const validUser = validateUuid(userId)
    const filter = validateAcHistoryQuery(query)
    const group = await this.repository.findGroup(validUser, filter.brandId, filter.modelId)
    const total = asNumber(group?.total)
    if (total === 0) {
      throw new AppError(404, 'AC_UNIT_NOT_FOUND', 'Không tìm thấy máy lạnh này trong tài khoản của bạn.')
    }
    const rows = total > filter.offset ? await this.repository.findHistory(validUser, filter) : []
    return {
      unit: {
        brandId: filter.brandId,
        modelId: filter.modelId,
        brandName: text(group.brandName),
        modelName: text(group.modelName),
        capacityBtu: group.capacityBtu == null ? null : asNumber(group.capacityBtu),
      },
      items: rows.map((row) => ({
        bookingId: row.bookingId,
        bookingCode: row.bookingCode,
        status: row.bookingStatus,
        scheduledAt: row.scheduledAt ?? null,
        completedAt: row.completedAt ?? null,
        totalAmount: asNumber(row.totalAmount),
        unitNumber: asNumber(row.unitNumber),
        description: text(row.description),
        diagnosis: text(row.diagnosis),
        serviceNotes: text(row.serviceNotes),
        technicianName: text(row.technicianName),
        phone: text(row.technicianPhone ?? row.phone),
        services: (Array.isArray(row.services) ? row.services : []).map((service) => ({
          id: service.id,
          name: String(service.name ?? ''),
          unitPrice: asNumber(service.unitPrice),
        })),
        additionalWork: (Array.isArray(row.additionalWork) ? row.additionalWork : []).map((item) => ({
          description: String(item.description ?? ''),
          totalPrice: asNumber(item.totalPrice),
        })),
      })),
      pagination: {
        page: filter.page,
        limit: filter.limit,
        total,
        totalPages: Math.ceil(total / filter.limit),
      },
      matchBasis: 'BRAND_AND_MODEL',
    }
  }
}
