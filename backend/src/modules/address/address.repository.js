import { randomUUID } from 'node:crypto'
import { pool, withTransaction } from '../../config/database.js'

const ADDRESS_FIELDS = `
  id,
  recipient_name,
  phone,
  address_line,
  ward,
  city,
  latitude,
  longitude,
  is_default,
  created_at,
  updated_at
`

const LOCATION_API_URL = 'https://provinces.open-api.vn/api/v2'

export class AddressRepository {
  // LOCATION

  async getProvinces() {
    const response = await fetch(
      `${LOCATION_API_URL}/p/`,
      {
        headers: {
          Accept: 'application/json',
        },
      },
    )

    if (!response.ok) {
      throw new Error('Unable to load provinces.')
    }

    const data = await response.json()

    return data.map((province) => ({
      code: province.code,
      name: province.name,
    }))
  }

  async getWards(provinceCode) {
    const response = await fetch(
      `${LOCATION_API_URL}/w/?province=${encodeURIComponent(provinceCode)}`,
      {
        headers: {
          Accept: 'application/json',
        },
      },
    )

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error('Unable to load wards.')
    }

    const data = await response.json()

    return data.map((ward) => ({
      code: ward.code,
      name: ward.name,
      province_code: ward.province_code,
    }))
  }

  // CUSTOMER

  async findCustomerProfileByUserId(userId, queryable = pool) {
    const result = await queryable.query(
      `
        SELECT id
        FROM customer_profiles
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId],
    )

    return result.rows[0] ?? null
  }

  // ADDRESS

  async findAllByCustomerId(customerId, queryable = pool) {
    const result = await queryable.query(
      `
        SELECT ${ADDRESS_FIELDS}
        FROM customer_addresses
        WHERE customer_id = $1
        ORDER BY is_default DESC, created_at DESC
      `,
      [customerId],
    )

    return result.rows
  }

  async findById(addressId, customerId, queryable = pool) {
    const result = await queryable.query(
      `
        SELECT ${ADDRESS_FIELDS}
        FROM customer_addresses
        WHERE id = $1
          AND customer_id = $2
        LIMIT 1
      `,
      [addressId, customerId],
    )

    return result.rows[0] ?? null
  }

  async create(customerId, input) {
    return withTransaction(async (client) => {
      const countResult = await client.query(
        `
          SELECT COUNT(*)::int AS count
          FROM customer_addresses
          WHERE customer_id = $1
        `,
        [customerId],
      )

      const isFirstAddress =
        countResult.rows[0].count === 0

      const shouldBeDefault =
        isFirstAddress || input.isDefault

      if (shouldBeDefault) {
        await client.query(
          `
            UPDATE customer_addresses
            SET
              is_default = false,
              updated_at = CURRENT_TIMESTAMP
            WHERE customer_id = $1
          `,
          [customerId],
        )
      }

      const result = await client.query(
        `
          INSERT INTO customer_addresses (
            id,
            customer_id,
            recipient_name,
            phone,
            address_line,
            ward,
            city,
            latitude,
            longitude,
            is_default
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10
          )
          RETURNING ${ADDRESS_FIELDS}
        `,
        [
          randomUUID(),
          customerId,
          input.recipientName,
          input.phone,
          input.addressLine,
          input.ward,
          input.city,
          input.latitude,
          input.longitude,
          shouldBeDefault,
        ],
      )

      return result.rows[0]
    })
  }

  async update(addressId, customerId, input) {
    return withTransaction(async (client) => {
      const existing = await this.findById(
        addressId,
        customerId,
        client,
      )

      if (!existing) {
        return null
      }

      const shouldBeDefault =
        existing.is_default || input.isDefault

      if (input.isDefault && !existing.is_default) {
        await client.query(
          `
            UPDATE customer_addresses
            SET
              is_default = false,
              updated_at = CURRENT_TIMESTAMP
            WHERE customer_id = $1
              AND id <> $2
          `,
          [customerId, addressId],
        )
      }

      const result = await client.query(
        `
          UPDATE customer_addresses
          SET
            recipient_name = $1,
            phone = $2,
            address_line = $3,
            ward = $4,
            city = $5,
            latitude = $6,
            longitude = $7,
            is_default = $8,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $9
            AND customer_id = $10
          RETURNING ${ADDRESS_FIELDS}
        `,
        [
          input.recipientName,
          input.phone,
          input.addressLine,
          input.ward,
          input.city,
          input.latitude,
          input.longitude,
          shouldBeDefault,
          addressId,
          customerId,
        ],
      )

      return result.rows[0] ?? null
    })
  }

  async delete(addressId, customerId) {
    return withTransaction(async (client) => {
      const existing = await this.findById(
        addressId,
        customerId,
        client,
      )

      if (!existing) {
        return null
      }

      await client.query(
        `
          DELETE FROM customer_addresses
          WHERE id = $1
            AND customer_id = $2
        `,
        [addressId, customerId],
      )

      // Nếu xóa default address,
      // tự chọn address còn lại mới nhất làm default.
      if (existing.is_default) {
        const nextResult = await client.query(
          `
            SELECT id
            FROM customer_addresses
            WHERE customer_id = $1
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [customerId],
        )

        if (nextResult.rows[0]) {
          await client.query(
            `
              UPDATE customer_addresses
              SET
                is_default = true,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
                AND customer_id = $2
            `,
            [
              nextResult.rows[0].id,
              customerId,
            ],
          )
        }
      }

      return existing
    })
  }

  async setDefault(addressId, customerId) {
    return withTransaction(async (client) => {
      const existing = await this.findById(
        addressId,
        customerId,
        client,
      )

      if (!existing) {
        return null
      }

      await client.query(
        `
          UPDATE customer_addresses
          SET
            is_default = false,
            updated_at = CURRENT_TIMESTAMP
          WHERE customer_id = $1
        `,
        [customerId],
      )

      const result = await client.query(
        `
          UPDATE customer_addresses
          SET
            is_default = true,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND customer_id = $2
          RETURNING ${ADDRESS_FIELDS}
        `,
        [
          addressId,
          customerId,
        ],
      )

      return result.rows[0] ?? null
    })
  }
}