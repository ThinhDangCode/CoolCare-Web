import { pool } from '../../config/database.js'

export class CustomerBookingRepository {
  constructor({ db = pool } = {}) {
    this.db = db
  }

  async findCustomer(userId, db = this.db) {
    const { rows } = await db.query(
      `SELECT cp.id FROM customer_profiles cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.user_id = $1 AND u.status = 'ACTIVE'`, [userId]
    )
    return rows[0] ?? null
  }

  async findAddress(customerId, addressId, db = this.db) {
    const { rows } = await db.query(
      `SELECT id, address_line, ward, city, latitude, longitude
       FROM customer_addresses WHERE id = $1 AND customer_id = $2`,
      [addressId, customerId]
    )
    return rows[0] ?? null
  }

  async findActiveServices(serviceIds, db = this.db) {
    const { rows } = await db.query(
      `SELECT id, base_price FROM services WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
      [serviceIds]
    )
    return rows
  }

  async findBrand(brandId, db = this.db) {
    const { rows } = await db.query(
      `SELECT id FROM ac_brands WHERE id = $1 AND is_active = TRUE`, [brandId]
    )
    return rows[0] ?? null
  }

  async findModel(modelId, brandId, db = this.db) {
    const { rows } = await db.query(
      `SELECT id FROM ac_models WHERE id = $1 AND brand_id = $2 AND is_active = TRUE`,
      [modelId, brandId]
    )
    return rows[0] ?? null
  }

  async createBooking(data, db) {
    const { rows } = await db.query(
      `INSERT INTO bookings (
        booking_code, customer_id, customer_address_id,
        recipient_name, recipient_phone, description,
        service_address, ward, city, latitude, longitude,
        scheduled_at, status, subtotal, discount_amount, total_amount
      ) VALUES (
        'BK-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 16)),
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        'PENDING', $12, 0, $12
      ) RETURNING *`,
      [data.customerId, data.addressId, data.recipientName,
        data.recipientPhone, data.description, data.addressLine,
        data.ward, data.city, data.latitude, data.longitude,
        data.scheduledAt, data.subtotal]
    )
    return rows[0]
  }

  async createUnit(bookingId, unitNumber, unit, db) {
    const { rows } = await db.query(
      `INSERT INTO booking_units (
        booking_id, unit_number, ac_brand_id, ac_model_id, description
      ) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [bookingId, unitNumber, unit.acBrandId, unit.acModelId, unit.description]
    )
    return rows[0]
  }

  async createUnitService(unitId, serviceId, price, db) {
    await db.query(
      `INSERT INTO booking_unit_services (booking_unit_id, service_id, unit_price)
       VALUES ($1, $2, $3)`, [unitId, serviceId, price]
    )
  }

  async insertStatusHistory(bookingId, userId, db) {
    await db.query(
      `INSERT INTO booking_status_history (booking_id, status, changed_by_id, note)
       VALUES ($1, 'PENDING', $2, 'Customer created booking.')`,
      [bookingId, userId]
    )
  }
}
