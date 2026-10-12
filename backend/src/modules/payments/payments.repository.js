import { withTransaction } from '../../config/database.js'

export class PaymentsRepository {
  constructor({ transaction = withTransaction } = {}) {
    this.transaction = transaction
  }

  async listPayments(filters) {
    return this.transaction(async (client) => {
      // Count and rows share one snapshot; listing cannot change payment or ledger data.
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const values = []
      const clauses = []
      const bind = (value) => {
        values.push(value)
        return `$${values.length}`
      }
      if (filters.search) {
        const term = bind(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`)
        clauses.push(
          `(p.payment_code ILIKE ${term} OR p.id::text ILIKE ${term}
            OR b.booking_code ILIKE ${term} OR u.full_name ILIKE ${term}
            OR COALESCE(u.phone, '') ILIKE ${term})`
        )
      }
      if (filters.status !== 'ALL') clauses.push(`p.payment_status = ${bind(filters.status)}`)
      if (filters.method !== 'ALL') clauses.push(`upper(trim(pm.code)) = ${bind(filters.method)}`)
      if (filters.from) {
        clauses.push(
          `p.created_at >= (${bind(filters.from)}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`
        )
      }
      if (filters.to) {
        clauses.push(
          `p.created_at < ((${bind(filters.to)}::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`
        )
      }
      const source = `FROM payments p
        JOIN bookings b ON b.id = p.booking_id
        JOIN customer_profiles cp ON cp.id = p.customer_id
        JOIN users u ON u.id = cp.user_id
        JOIN payment_methods pm ON pm.id = p.payment_method_id`
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const count = await client.query(`SELECT count(*)::int AS total ${source}${where}`, values)
      const result = await client.query(
        `SELECT p.id, p.payment_code AS "paymentCode", b.booking_code AS "bookingCode",
          u.full_name AS "customerName", u.phone AS "customerPhone", p.amount,
          upper(trim(pm.code)) AS "methodCode", pm.name AS "methodName",
          p.payment_status AS status, p.created_at AS "createdAt"
         ${source}${where}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, filters.limit, (filters.page - 1) * filters.limit]
      )
      const total = count.rows[0].total
      return {
        items: result.rows,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit),
        },
      }
    })
  }

  async getPayment(id) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const result = await client.query(
        `SELECT p.id, p.payment_code AS "paymentCode", p.payment_status AS status,
          p.amount, upper(trim(pm.code)) AS "methodCode", pm.name AS "methodName",
          p.payment_kind AS kind, p.transaction_reference AS "transactionReference",
          p.created_at AS "createdAt", p.updated_at AS "updatedAt",
          p.paid_at AS "paidAt", p.settled_at AS "settledAt",
          p.cash_received_at AS "cashReceivedAt", p.closure_verified_at AS "closureVerifiedAt",
          p.closure_reference AS "closureReference", p.commission_rate AS "commissionRate",
          p.commission_base_amount AS "commissionBaseAmount",
          p.commission_amount AS "commissionAmount",
          p.platform_discount_amount AS "platformDiscountAmount",
          p.technician_earning AS "technicianEarning", transaction_timestamp() AS "readAt",
          b.id AS "bookingId", b.booking_code AS "bookingCode", b.status AS "bookingStatus",
          b.scheduled_at AS "scheduledAt", b.description AS "bookingDescription",
          b.recipient_name AS "recipientName", b.recipient_phone AS "recipientPhone",
          b.service_address AS "serviceAddress", b.ward, to_jsonb(b)->>'district' AS district, b.city,
          b.technician_completed_at AS "technicianCompletedAt",
          b.completion_confirmed_at AS "completionConfirmedAt", b.completed_at AS "completedAt",
          COALESCE(b.completion_confirmed_at IS NOT NULL
            AND b.completion_confirmed_by_id = cu.id, false) AS "customerConfirmedCompletion",
          b.subtotal, b.discount_amount AS "discountAmount", b.total_amount AS "totalAmount",
          pricing.parts_amount AS "partsAmount", pricing.subtotal AS "quotationSubtotal",
          lines.total_price AS "itemServiceLaborTotal",
          (p.amount = b.total_amount AND p.platform_discount_amount = b.discount_amount
            AND p.commission_base_amount = b.subtotal - pricing.parts_amount) AS "pricingMatchesPayment",
          (pricing.subtotal = b.subtotal) AS "quotationTotalsMatchBooking",
          (lines.total_price + pricing.parts_amount = pricing.subtotal) AS "itemBreakdownMatchesQuotation",
          cp.id AS "customerId", cu.id AS "customerUserId", cu.full_name AS "customerName",
          cu.phone AS "customerPhone", cu.email AS "customerEmail", cu.avatar_url AS "customerAvatarUrl",
          (SELECT count(*)::int FROM bookings completed
            WHERE completed.customer_id = cp.id AND completed.status = 'COMPLETED') AS "completedBookingCount",
          p.technician_id AS "technicianId", tu.id AS "technicianUserId",
          tu.full_name AS "technicianName", tu.phone AS "technicianPhone",
          tu.email AS "technicianEmail", tu.avatar_url AS "technicianAvatarUrl",
          tp.rating_average AS "ratingAverage", tp.total_reviews AS "totalReviews"
         FROM payments p
         JOIN payment_methods pm ON pm.id = p.payment_method_id
         JOIN bookings b ON b.id = p.booking_id
         JOIN customer_profiles cp ON cp.id = p.customer_id
         JOIN users cu ON cu.id = cp.user_id
         LEFT JOIN technician_profiles tp ON tp.id = p.technician_id
         LEFT JOIN users tu ON tu.id = tp.user_id
         CROSS JOIN LATERAL (
           SELECT SUM(q.parts_amount) AS parts_amount, SUM(q.subtotal) AS subtotal
           FROM quotations q WHERE q.booking_id = b.id AND q.status = 'ACCEPTED'
         ) pricing
         CROSS JOIN LATERAL (
           SELECT SUM(qi.total_price) AS total_price
           FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id
           WHERE q.booking_id = b.id AND q.status = 'ACCEPTED'
         ) lines
         WHERE p.id = $1`,
        [id]
      )
      const row = result.rows[0]
      if (!row) return null

      const quotations = await client.query(
        `SELECT id, quotation_number AS number, quotation_type AS type,
          subtotal, parts_amount AS "partsAmount", labor_amount AS "laborAmount",
          discount_amount AS "discountAmount", total_amount AS "totalAmount",
          responded_at AS "respondedAt"
         FROM quotations WHERE booking_id = $1 AND status = 'ACCEPTED'
         ORDER BY quotation_number, id`,
        [row.bookingId]
      )
      const items = await client.query(
        `SELECT qi.id, qi.quotation_id AS "quotationId", qi.item_type AS "itemType",
          qi.description, qi.quantity, qi.unit, qi.unit_price AS "unitPrice",
          qi.total_price AS "totalPrice", qi.discount_amount AS "discountAmount"
         FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id
         WHERE q.booking_id = $1 AND q.status = 'ACCEPTED'
         ORDER BY q.quotation_number, qi.id`,
        [row.bookingId]
      )
      let serviceZones = []
      let ledger = []
      if (row.technicianId) {
        serviceZones = (await client.query(
          `SELECT city, to_jsonb(ta)->>'district' AS district, ward
           FROM technician_areas ta WHERE technician_id = $1
           ORDER BY city, district NULLS LAST, ward NULLS LAST, id`,
          [row.technicianId]
        )).rows
        ledger = (await client.query(
          `SELECT st.id, st.transaction_type AS "transactionType", st.amount,
            st.created_at AS "createdAt"
           FROM settlement_transactions st
           JOIN technician_accounts a ON a.id = st.technician_account_id
           WHERE st.payment_id = $1 AND a.technician_id = $2
           ORDER BY st.created_at, st.id`,
          [id, row.technicianId]
        )).rows
      }
      // Invoices have only booking_id. Only the matching successful attempt can own one.
      const invoice = row.status === 'SUCCESS' ? (await client.query(
        `SELECT id, invoice_number AS "invoiceNumber", pdf_url AS "pdfUrl",
          issued_at AS "issuedAt", total_amount AS "totalAmount"
         FROM invoices WHERE booking_id = $1 AND customer_id = $2 AND total_amount = $3`,
        [row.bookingId, row.customerId, row.amount]
      )).rows[0] ?? null : null

      return {
        id: row.id,
        paymentCode: row.paymentCode,
        status: row.status,
        amount: row.amount,
        methodCode: row.methodCode,
        methodName: row.methodName,
        kind: row.kind,
        transactionReference: row.transactionReference,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        paidAt: row.paidAt,
        settledAt: row.settledAt,
        cashReceivedAt: row.cashReceivedAt,
        closureVerifiedAt: row.closureVerifiedAt,
        closureReference: row.closureReference,
        commissionRate: row.commissionRate,
        commissionBaseAmount: row.commissionBaseAmount,
        commissionAmount: row.commissionAmount,
        platformDiscountAmount: row.platformDiscountAmount,
        technicianEarning: row.technicianEarning,
        readAt: row.readAt,
        booking: {
          id: row.bookingId,
          bookingCode: row.bookingCode,
          status: row.bookingStatus,
          scheduledAt: row.scheduledAt,
          description: row.bookingDescription,
          recipientName: row.recipientName,
          recipientPhone: row.recipientPhone,
          serviceAddress: row.serviceAddress,
          ward: row.ward,
          district: row.district,
          city: row.city,
          technicianCompletedAt: row.technicianCompletedAt,
          completionConfirmedAt: row.completionConfirmedAt,
          completedAt: row.completedAt,
          customerConfirmedCompletion: row.customerConfirmedCompletion,
          totals: {
            subtotal: row.subtotal,
            discountAmount: row.discountAmount,
            totalAmount: row.totalAmount,
            partsAmount: row.partsAmount,
            quotationSubtotal: row.quotationSubtotal,
            itemServiceLaborTotal: row.itemServiceLaborTotal,
          },
          pricingMatchesPayment: row.pricingMatchesPayment,
          quotationTotalsMatchBooking: row.quotationTotalsMatchBooking,
          itemBreakdownMatchesQuotation: row.itemBreakdownMatchesQuotation,
          quotations: quotations.rows,
          items: items.rows,
        },
        customer: {
          id: row.customerId,
          userId: row.customerUserId,
          name: row.customerName,
          phone: row.customerPhone,
          email: row.customerEmail,
          avatarUrl: row.customerAvatarUrl,
          completedBookingCount: row.completedBookingCount,
        },
        technician: row.technicianId ? {
          id: row.technicianId,
          userId: row.technicianUserId,
          name: row.technicianName,
          phone: row.technicianPhone,
          email: row.technicianEmail,
          avatarUrl: row.technicianAvatarUrl,
          ratingAverage: row.ratingAverage,
          totalReviews: row.totalReviews,
          serviceZones,
        } : null,
        ledger,
        invoice,
      }
    })
  }
}
