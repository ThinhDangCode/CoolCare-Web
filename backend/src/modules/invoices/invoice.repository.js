import { pool, withTransaction } from '../../config/database.js'

// Read-only queries. Every lookup is scoped to the signed-in customer's own
// payment so an id from another account behaves exactly like a missing one.
export class InvoiceRepository {
  constructor({ transaction = withTransaction, query = (...args) => pool.query(...args) } = {}) {
    this.transaction = transaction
    this.query = query
  }

  async findForCustomer(userId, paymentId) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const payment = (await client.query(
        `SELECT p.id AS "paymentId", p.payment_code AS "paymentCode", p.amount,
                p.payment_status AS status, p.paid_at AS "paidAt",
                p.transaction_reference AS "transactionReference",
                upper(trim(pm.code)) AS "methodCode",
                b.id AS "bookingId", b.booking_code AS "bookingCode",
                b.scheduled_at AS "scheduledAt", b.completed_at AS "completedAt",
                b.description AS "bookingDescription",
                b.service_address AS "serviceAddress", b.ward,
                to_jsonb(b)->>'district' AS district, b.city,
                cp.id AS "customerId", cu.id AS "customerUserId",
                cu.full_name AS "customerName", cu.phone AS "customerPhone",
                cu.email AS "customerEmail", tu.full_name AS "technicianName"
           FROM payments p
           JOIN payment_methods pm ON pm.id = p.payment_method_id
           JOIN bookings b ON b.id = p.booking_id
           JOIN customer_profiles cp ON cp.id = p.customer_id
           JOIN users cu ON cu.id = cp.user_id
           LEFT JOIN technician_profiles tp ON tp.id = p.technician_id
           LEFT JOIN users tu ON tu.id = tp.user_id
          WHERE p.id = $1 AND cu.id = $2`,
        [paymentId, userId]
      )).rows[0]
      if (!payment) return null
      if (payment.status !== 'SUCCESS') return { payment, invoice: null, items: [], paidAmount: 0 }

      // Invoices only carry booking_id, so the totals must match this payment.
      const invoice = (await client.query(
        `SELECT id, invoice_number AS "invoiceNumber", issued_at AS "issuedAt",
                parts_amount AS "partsAmount", subtotal,
                discount_amount AS "discountAmount", total_amount AS "totalAmount"
           FROM invoices
          WHERE booking_id = $1 AND customer_id = $2 AND total_amount = $3
          ORDER BY issued_at DESC, id DESC LIMIT 1`,
        [payment.bookingId, payment.customerId, payment.amount]
      )).rows[0] ?? null
      if (!invoice) return { payment, invoice: null, items: [], paidAmount: 0 }

      const items = (await client.query(
        `SELECT id, item_type AS "itemType", description, quantity, unit,
                unit_price AS "unitPrice", total_price AS "totalPrice"
           FROM invoice_items WHERE invoice_id = $1
          ORDER BY item_type, description, id`,
        [invoice.id]
      )).rows
      const paid = (await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments
          WHERE booking_id = $1 AND payment_status = 'SUCCESS'`,
        [payment.bookingId]
      )).rows[0]
      return { payment, invoice, items, paidAmount: paid.paid }
    })
  }

  // Issues the invoice of a SUCCESS payment when none exists yet (idempotent).
  // Lines come from the accepted quotations, or from the booked services when
  // the booking had no quotation. Totals mirror the booking, like the payment.
  async ensureInvoice(paymentId) {
    return this.transaction(async (client) => {
      const payment = (await client.query(
        `SELECT p.id, p.booking_id AS "bookingId", p.customer_id AS "customerId",
                p.amount, p.paid_at AS "paidAt", b.subtotal,
                b.discount_amount AS "discountAmount", b.total_amount AS "totalAmount"
           FROM payments p JOIN bookings b ON b.id = p.booking_id
          WHERE p.id = $1 AND p.payment_status = 'SUCCESS'
          FOR UPDATE OF p`,
        [paymentId]
      )).rows[0]
      if (!payment) return false
      const existing = await client.query(
        `SELECT id FROM invoices WHERE booking_id = $1 AND customer_id = $2 AND total_amount = $3 LIMIT 1`,
        [payment.bookingId, payment.customerId, payment.amount]
      )
      if (existing.rowCount) return false

      const parts = (await client.query(
        `SELECT COALESCE(SUM(parts_amount), 0) AS parts FROM quotations
          WHERE booking_id = $1 AND status = 'ACCEPTED'`,
        [payment.bookingId]
      )).rows[0].parts
      const number = `INV-${new Date(payment.paidAt ?? Date.now()).toISOString().slice(0, 10).replaceAll('-', '')}-${String(paymentId).replaceAll('-', '').slice(0, 6).toUpperCase()}`
      const invoice = (await client.query(
        `INSERT INTO invoices(invoice_number, booking_id, customer_id, parts_amount, subtotal, discount_amount, total_amount, issued_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_TIMESTAMP))
         RETURNING id`,
        [number, payment.bookingId, payment.customerId, parts, payment.subtotal, payment.discountAmount, payment.amount, payment.paidAt]
      )).rows[0]

      const fromQuotes = await client.query(
        `INSERT INTO invoice_items(invoice_id, quotation_item_id, booking_unit_service_id, item_type, description, quantity, unit, unit_price, total_price, discount_amount)
         SELECT $1, qi.id, qi.booking_unit_service_id, qi.item_type, qi.description, qi.quantity, qi.unit, qi.unit_price, qi.total_price, 0
           FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id
          WHERE q.booking_id = $2 AND q.status = 'ACCEPTED'`,
        [invoice.id, payment.bookingId]
      )
      if (!fromQuotes.rowCount) {
        await client.query(
          `INSERT INTO invoice_items(invoice_id, booking_unit_service_id, item_type, description, quantity, unit, unit_price, total_price, discount_amount)
           SELECT $1, bus.id, 'SERVICE', s.name, 1, 'lần', bus.unit_price, bus.unit_price, 0
             FROM booking_unit_services bus
             JOIN booking_units bu ON bu.id = bus.booking_unit_id
             JOIN services s ON s.id = bus.service_id
            WHERE bu.booking_id = $2`,
          [invoice.id, payment.bookingId]
        )
      }
      return true
    })
  }

  // Successful payments of the last days whose invoice email was never recorded.
  async findPendingEmails(limit = 10) {
    const result = await this.query(
      `SELECT p.id AS "paymentId", cu.id AS "userId"
         FROM payments p
         JOIN customer_profiles cp ON cp.id = p.customer_id
         JOIN users cu ON cu.id = cp.user_id
        WHERE p.payment_status = 'SUCCESS'
          AND p.paid_at >= CURRENT_TIMESTAMP - interval '3 days'
          AND cu.email IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.user_id = cu.id AND n.reference_id = p.booking_id::text
               AND n.title = $1)
        ORDER BY p.paid_at ASC, p.id ASC
        LIMIT $2`,
      [INVOICE_EMAIL_NOTIFICATION_TITLE, limit]
    )
    return result.rows
  }

  async recordEmailSent({ userId, bookingId, invoiceNumber }) {
    await this.query(
      `INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
       VALUES($1,'PAYMENT',$2,$3,'BOOKING',$4)`,
      [
        userId,
        INVOICE_EMAIL_NOTIFICATION_TITLE,
        `Hóa đơn ${invoiceNumber} đã được gửi tới email của bạn.`,
        bookingId,
      ]
    )
  }
}

export const INVOICE_EMAIL_NOTIFICATION_TITLE = 'Hóa đơn đã được gửi qua email'
