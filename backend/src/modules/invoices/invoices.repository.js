import { withTransaction } from '../../config/database.js'
import { requireValidBody } from '../../utils.js'

// A payment attempt cannot own an invoice by booking alone. Exact customer and
// invoiced total must match, including successful zero-value FREE payments.
const matchingPayment = `p.booking_id=i.booking_id AND p.customer_id=i.customer_id
    AND p.amount=i.total_amount AND p.payment_status='SUCCESS'`
export const INVOICE_PAID_SQL = `EXISTS (SELECT 1 FROM payments p WHERE ${matchingPayment})`

// Only invoiced lines participate. Booking guards keep unrelated line references
// from attributing another booking's service to this invoice. A LABOR line may
// name its booked service directly, but its description is never guessed.
const itemSource = `FROM invoice_items ii
  LEFT JOIN booking_unit_services bus ON bus.id=ii.booking_unit_service_id
  LEFT JOIN booking_units bu ON bu.id=bus.booking_unit_id AND bu.booking_id=i.booking_id
  LEFT JOIN quotations q ON q.booking_id=i.booking_id
    AND EXISTS (SELECT 1 FROM quotation_items linked_qi WHERE linked_qi.id=ii.quotation_item_id AND linked_qi.quotation_id=q.id)
  LEFT JOIN quotation_items qi ON qi.id=ii.quotation_item_id AND qi.quotation_id=q.id
  LEFT JOIN services s ON s.id=COALESCE(
    CASE WHEN bu.id IS NOT NULL THEN bus.service_id END,
    CASE WHEN ii.item_type='SERVICE' AND qi.item_type='SERVICE' THEN qi.service_id END)
  WHERE ii.invoice_id=i.id`

export const INVOICE_SERVICE_OPTIONS_SQL = `SELECT DISTINCT linked.id,linked.name
  FROM invoices i CROSS JOIN LATERAL (
    SELECT s.id,s.name ${itemSource} AND s.id IS NOT NULL
  ) linked ORDER BY linked.name,linked.id`

const source = `FROM invoices i
  JOIN bookings b ON b.id=i.booking_id
  JOIN customer_profiles cp ON cp.id=i.customer_id
  JOIN users u ON u.id=cp.user_id`

// The invoice snapshots own the displayed prices. Service joins only identify a
// linked service; current quotations, catalogue prices and assignments cannot
// rewrite an invoice. Cast decimals inside JSON to preserve their exact value.
export const INVOICE_DETAIL_SQL = `SELECT i.id,i.invoice_number AS "invoiceNumber",
  i.issued_at AS "issuedAt",i.pdf_url AS "pdfUrl",
  CASE WHEN ${INVOICE_PAID_SQL} THEN 'PAID' ELSE 'UNRECORDED' END AS "paymentStatus",
  i.customer_id AS "customerId",u.full_name AS "customerName",u.phone AS "customerPhone",
  b.id AS "bookingId",b.booking_code AS "bookingCode",
  NULLIF(concat_ws(', ',NULLIF(b.service_address,''),NULLIF(b.ward,''),
    NULLIF(to_jsonb(b)->>'district',''),NULLIF(b.city,'')),'') AS "bookingAddress",
  b.recipient_name AS "recipientName",b.recipient_phone AS "recipientPhone",
  b.scheduled_at AS "scheduledStart",NULL AS "scheduledEnd",b.completed_at AS "completedAt",
  tp.id AS "technicianId",tu.full_name AS "technicianName",tu.phone AS "technicianPhone",
  i.subtotal,i.parts_amount AS "partsAmount",i.discount_amount AS "discountAmount",i.total_amount AS "totalAmount",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',ii.id,'itemType',CASE WHEN ii.item_type='SERVICE' THEN 'SERVICE'
      WHEN ii.item_type='LABOR' THEN 'LABOR' END,
    'description',ii.description,'quantity',ii.quantity::text,'unit',ii.unit,
    'unitPrice',ii.unit_price::text,'totalPrice',ii.total_price::text,'discountAmount',ii.discount_amount::text,
    'service',CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('id',s.id,'name',s.name) END)
    ORDER BY ii.id) ${itemSource}),'[]'::jsonb) AS items,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'code',p.payment_code,
    'method',upper(trim(pm.code)),'amount',p.amount::text,'paidAt',p.paid_at)
    ORDER BY p.paid_at DESC NULLS LAST,p.id DESC)
    FROM payments p LEFT JOIN payment_methods pm ON pm.id=p.payment_method_id
    WHERE ${matchingPayment}),'[]'::jsonb) AS payments
  ${source}
  LEFT JOIN technician_profiles tp ON tp.user_id=b.technician_completed_by_id
  LEFT JOIN users tu ON tu.id=tp.user_id
  WHERE i.id=$1::uuid`

export function buildInvoiceListQueries(filters) {
  const values = []
  const clauses = []
  const bind = (value) => { values.push(value); return `$${values.length}` }
  if (filters.search) {
    const term = bind(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`)
    clauses.push(`(i.invoice_number ILIKE ${term} OR b.booking_code ILIKE ${term}
      OR u.full_name ILIKE ${term} OR COALESCE(u.phone,'') ILIKE ${term})`)
  }
  if (filters.status === 'PAID') clauses.push(INVOICE_PAID_SQL)
  if (filters.status === 'UNRECORDED') clauses.push(`NOT ${INVOICE_PAID_SQL}`)
  if (filters.service !== 'ALL') clauses.push(`EXISTS (SELECT 1 ${itemSource} AND s.id=${bind(filters.service)}::uuid)`)
  if (filters.from)
    clauses.push(`i.issued_at >= (${bind(filters.from)}::date::timestamp AT TIME ZONE INTERVAL '+07:00')`)
  if (filters.to)
    clauses.push(`i.issued_at < ((${bind(filters.to)}::date+1)::timestamp AT TIME ZONE INTERVAL '+07:00')`)
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  return {
    countSql: `SELECT count(*)::int AS total ${source}${where}`,
    rowsSql: `SELECT i.id,i.invoice_number AS "invoiceNumber",i.booking_id AS "bookingId",
      b.booking_code AS "bookingCode",i.customer_id AS "customerId",u.full_name AS "customerName",
      u.phone AS "customerPhone",i.total_amount AS amount,i.issued_at AS "issuedAt",i.pdf_url AS "pdfUrl",
      CASE WHEN ${INVOICE_PAID_SQL} THEN 'PAID' ELSE 'UNRECORDED' END AS "paymentStatus",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',billable.id,'name',billable.name) ORDER BY billable.name,billable.id)
        FROM (SELECT DISTINCT s.id,s.name ${itemSource} AND s.id IS NOT NULL) billable),'[]'::jsonb) AS services,
      EXISTS (SELECT 1 ${itemSource} AND ii.item_type='SERVICE' AND s.id IS NULL) AS "hasUnlinkedService",
      EXISTS (SELECT 1 ${itemSource} AND ii.item_type='LABOR' AND s.id IS NULL) AS "hasUnlinkedLabor"
      ${source}${where} ORDER BY i.issued_at DESC,i.id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    values,
    rowValues: [...values, filters.limit, (filters.page - 1) * filters.limit],
  }
}

export function safeInvoicePdfUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function presentInvoiceRow(row) {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    booking: { id: row.bookingId, code: row.bookingCode },
    customer: { id: row.customerId, name: row.customerName, phone: row.customerPhone },
    services: row.services,
    hasUnlinkedService: row.hasUnlinkedService,
    hasUnlinkedLabor: row.hasUnlinkedLabor,
    amount: row.amount,
    issuedAt: row.issuedAt,
    paymentStatus: row.paymentStatus,
    pdfUrl: safeInvoicePdfUrl(row.pdfUrl),
  }
}

export function presentInvoiceDetail(row) {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    issuedAt: row.issuedAt,
    paymentStatus: row.paymentStatus,
    pdfUrl: safeInvoicePdfUrl(row.pdfUrl),
    customer: { id: row.customerId, name: row.customerName, phone: row.customerPhone },
    booking: {
      id: row.bookingId, code: row.bookingCode, address: row.bookingAddress,
      recipientName: row.recipientName, recipientPhone: row.recipientPhone,
      scheduledStart: row.scheduledStart, scheduledEnd: row.scheduledEnd, completedAt: row.completedAt,
    },
    technician: row.technicianId
      ? { id: row.technicianId, name: row.technicianName, phone: row.technicianPhone } : null,
    totals: {
      subtotal: row.subtotal, partsAmount: row.partsAmount,
      discountAmount: row.discountAmount, totalAmount: row.totalAmount,
    },
    items: row.items.map((item) => ({
      id: item.id, itemType: item.itemType, description: item.description,
      quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice,
      totalPrice: item.totalPrice, discountAmount: item.discountAmount,
      service: item.service ? { id: item.service.id, name: item.service.name } : null,
    })),
    payments: row.payments.map((payment) => ({
      id: payment.id, code: payment.code, method: payment.method,
      amount: payment.amount, paidAt: payment.paidAt,
    })),
  }
}

export class InvoicesRepository {
  constructor({ transaction = withTransaction } = {}) { this.transaction = transaction }
  async getInvoice(id) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const row = (await client.query(INVOICE_DETAIL_SQL, [id])).rows[0]
      return row ? presentInvoiceDetail(row) : null
    })
  }

  async listInvoices(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const services = (await client.query(INVOICE_SERVICE_OPTIONS_SQL)).rows
      if (filters.service !== 'ALL' && !services.some((service) => service.id === filters.service)) {
        const service = (await client.query('SELECT id,name FROM services WHERE id=$1', [filters.service])).rows[0]
        requireValidBody({ service: service ? null : 'Không tìm thấy dịch vụ.' })
        services.push(service)
        services.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      }
      const { countSql, rowsSql, values, rowValues } = buildInvoiceListQueries(filters)
      const total = (await client.query(countSql, values)).rows[0].total
      const rows = (await client.query(rowsSql, rowValues)).rows
      return {
        items: rows.map(presentInvoiceRow),
        pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
        options: { services },
      }
    })
  }
}
