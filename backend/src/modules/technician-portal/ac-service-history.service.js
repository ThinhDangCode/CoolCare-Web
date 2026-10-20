import { AppError, validateUuid } from '../../utils.js'
import { AcServiceHistoryRepository } from './ac-service-history.repository.js'
import { validateAcServiceHistoryQuery } from './ac-service-history.validation.js'

export class AcServiceHistoryService {
  constructor(repository = new AcServiceHistoryRepository()) { this.repository = repository }

  async getHistory(userId, requestId, unitId, query = {}) {
    if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập để tiếp tục.')
    const validUserId = validateUuid(userId)
    const validRequestId = validateUuid(requestId)
    const validUnitId = validateUuid(unitId)
    const paging = validateAcServiceHistoryQuery(query)
    const context = await this.repository.findAccessibleUnit(validUserId, validRequestId, validUnitId)
    if (!context) {
      throw new AppError(404, 'AC_UNIT_NOT_ACCESSIBLE', 'Không tìm thấy máy lạnh trong công việc đang xử lý.')
    }
    const [total, rows] = await Promise.all([
      this.repository.countHistory(context),
      this.repository.findHistory(context, paging),
    ])
    return {
      unit: {
        id: context.unit_id,
        unitNumber: context.unit_number,
        brandId: context.ac_brand_id,
        brandName: context.brand_name,
        modelId: context.ac_model_id,
        modelName: context.model_name,
        description: context.description,
      },
      matchBasis: {
        customerScoped: true,
        brandAndModel: true,
        persistentAssetId: false,
        notice: 'Lịch sử được đối chiếu theo cùng khách hàng, hãng và model vì hệ thống chưa lưu mã định danh riêng của máy.',
      },
      items: rows.map((row) => ({
        bookingId: row.booking_id,
        bookingCode: row.booking_code,
        scheduledAt: row.scheduled_at,
        completedAt: row.completed_at,
        bookingDescription: row.booking_description,
        totalAmount: Number(row.total_amount),
        unit: {
          id: row.unit_id,
          unitNumber: row.unit_number,
          brandName: row.brand_name,
          modelName: row.model_name,
          description: row.description,
        },
        diagnosis: row.diagnosis,
        serviceNotes: row.service_notes,
        technicianName: row.technician_name,
        services: Array.isArray(row.services) ? row.services.map((service) => ({
          id: service.id,
          name: service.name,
          unitPrice: Number(service.unitPrice),
        })) : [],
        additionalWorkScope: 'BOOKING',
        additionalWork: Array.isArray(row.additional_work) ? row.additional_work.map((item) => ({
          quotationId: item.quotationId,
          quotationNumber: Number(item.quotationNumber),
          reason: item.reason,
          note: item.note,
          itemId: item.itemId,
          itemType: item.itemType,
          description: item.description,
          quantity: Number(item.quantity),
          unit: item.unit,
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
        })) : [],
      })),
      pagination: {
        page: paging.page,limit: paging.limit,total,
        totalPages: Math.ceil(total / paging.limit),
      },
    }
  }
}
