import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { InvoicesRepository } from '../src/modules/invoices/invoices.repository.js'
import { validateInvoiceListQuery } from '../src/modules/invoices/invoices.validation.js'

const enabled = process.env.RUN_INVOICES_DB_TESTS === '1'
const fixtureId = (prefix, ordinal) => `${prefix}0000000-0000-0000-0000-${String(ordinal).padStart(12, '0')}`
const serviceA = fixtureId(6, 1)
const serviceB = fixtureId(6, 2)
const unusedService = fixtureId(6, 3)
const fixtureSql = `WITH invoices AS (
    SELECT ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS id,
      'SYNTHETIC-INV-'||n::text AS invoice_number,
      ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS booking_id,
      '30000000-0000-0000-0000-000000000001'::uuid AS customer_id,
      CASE WHEN n=9 THEN 0.00 ELSE 12.34 END::numeric(12,2) AS parts_amount,
      CASE WHEN n=9 THEN 0.00 ELSE 112.34 END::numeric(12,2) AS subtotal,
      CASE WHEN n=9 THEN 0.00 ELSE 12.34 END::numeric(12,2) AS discount_amount,
      CASE WHEN n=9 THEN 0.00 ELSE 100.00 END::numeric AS total_amount,
      CASE n WHEN 1 THEN '2026-10-01 00:00:00+07'::timestamptz
        WHEN 2 THEN '2026-10-01 23:59:59.999+07'::timestamptz
        WHEN 3 THEN '2026-10-02 00:00:00+07'::timestamptz
        WHEN 4 THEN '2026-09-30 23:59:59.999+07'::timestamptz
        ELSE '2026-10-01 12:00:00+07'::timestamptz END AS issued_at,
      CASE WHEN n=2 THEN 'javascript:alert(1)' ELSE 'https://example.com/invoice.pdf' END AS pdf_url
    FROM generate_series(1,12) n
  ), bookings AS (
    SELECT ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS id,'SYNTHETIC-BK-'||n::text AS booking_code,
      'Stored booking street'::text AS service_address,'Stored ward'::text AS ward,'Stored city'::text AS city,
      'Stored recipient'::text AS recipient_name,'0911111111'::text AS recipient_phone,
      '2026-09-30 09:00:00+07'::timestamptz AS scheduled_at,
      CASE WHEN n=2 THEN NULL ELSE '2026-09-30 11:00:00+07'::timestamptz END AS completed_at,
      CASE WHEN n=2 THEN NULL ELSE '40000000-0000-0000-0000-000000000005'::uuid END AS technician_completed_by_id
    FROM generate_series(1,12) n
  ), customer_profiles AS (
    SELECT '30000000-0000-0000-0000-000000000001'::uuid AS id,'40000000-0000-0000-0000-000000000001'::uuid AS user_id
  ), users AS (
    SELECT '40000000-0000-0000-0000-000000000001'::uuid AS id,'Synthetic%_\\ Customer'::text AS full_name,'0900000000'::text AS phone
    UNION ALL SELECT '40000000-0000-0000-0000-000000000005'::uuid,'Actual completing technician','0922222222'
  ), technician_profiles AS (
    SELECT '40000000-0000-0000-0000-000000000010'::uuid AS id,
      '40000000-0000-0000-0000-000000000005'::uuid AS user_id
  ), services AS (
    SELECT ('60000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS id,
      CASE n WHEN 1 THEN 'A inactive billed service' WHEN 2 THEN 'B quotation service'
        WHEN 3 THEN 'C unused service' ELSE 'D foreign-booking service' END AS name,n<>1 AS is_active
    FROM generate_series(1,4) n
  ), booking_units AS (
    SELECT ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS id,
      ('20000000-0000-0000-0000-'||lpad((CASE WHEN n=13 THEN 99 ELSE n END)::text,12,'0'))::uuid AS booking_id
    FROM generate_series(1,13) n
  ), booking_unit_services AS (
    SELECT ('70000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS id,
      ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS booking_unit_id,
      ('60000000-0000-0000-0000-'||lpad((CASE WHEN n=13 THEN 4 ELSE 1 END)::text,12,'0'))::uuid AS service_id
    FROM generate_series(1,13) n
  ), quotations AS (
    SELECT ('80000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS id,
      ('20000000-0000-0000-0000-'||lpad((CASE n WHEN 2 THEN 99 WHEN 4 THEN 3 ELSE n END)::text,12,'0'))::uuid AS booking_id
    FROM generate_series(1,4) n
  ), quotation_items AS (
    SELECT ('90000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS id,
      ('80000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS quotation_id,
      CASE WHEN n=4 THEN 1 ELSE 0 END::smallint AS item_type,
      CASE WHEN n=4 THEN NULL ELSE '60000000-0000-0000-0000-000000000002'::uuid END AS service_id
    FROM generate_series(1,4) n
  ), invoice_items AS (
    SELECT ('b0000000-0000-0000-0000-'||lpad((row_number() OVER ())::text,12,'0'))::uuid AS id,
      ('10000000-0000-0000-0000-'||lpad(invoice_n::text,12,'0'))::uuid AS invoice_id,
      'Stored invoice line description'::text AS description,1.234::numeric(12,3) AS quantity,
      'stored unit'::text AS unit,60.00::numeric(12,2) AS unit_price,
      50.00::numeric(12,2) AS total_price,3.00::numeric(12,2) AS discount_amount,
      CASE WHEN bus_n IS NULL THEN NULL ELSE ('70000000-0000-0000-0000-'||lpad(bus_n::text,12,'0'))::uuid END AS booking_unit_service_id,
      CASE WHEN qi_n IS NULL THEN NULL ELSE ('90000000-0000-0000-0000-'||lpad(qi_n::text,12,'0'))::uuid END AS quotation_item_id,
      item_code::smallint AS item_type
    FROM (VALUES (1,1,NULL,0),(1,1,NULL,0),(1,NULL,1,0),(1,NULL,NULL,1),
      (2,13,NULL,0),(2,NULL,2,0),(3,NULL,3,0),(3,NULL,4,1),(4,4,NULL,1),
      (5,5,NULL,0),(6,6,NULL,0),(7,7,NULL,0),(8,8,NULL,0),(9,9,NULL,0),
      (10,10,NULL,0),(11,11,NULL,0),(12,12,NULL,0),(12,13,NULL,1)) lines(invoice_n,bus_n,qi_n,item_code)
  ), payments AS (
    SELECT ('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS id,'SYNTHETIC-PAY-'||n::text AS payment_code,
      ('a0000000-0000-0000-0000-'||lpad((CASE WHEN n=9 THEN 2 ELSE 1 END)::text,12,'0'))::uuid AS payment_method_id,
      CASE WHEN n=9 THEN NULL ELSE '2026-10-01 13:00:00+07'::timestamptz END AS paid_at,
      ('20000000-0000-0000-0000-'||lpad((CASE WHEN n=4 THEN 99 WHEN n=13 THEN 1 ELSE n END)::text,12,'0'))::uuid AS booking_id,
      ('30000000-0000-0000-0000-'||lpad((CASE WHEN n=3 THEN 2 ELSE 1 END)::text,12,'0'))::uuid AS customer_id,
      CASE WHEN n=2 THEN 99.00 WHEN n=9 THEN 0.00 ELSE 100.00 END::numeric AS amount,
      CASE n WHEN 5 THEN 3 WHEN 6 THEN 4 WHEN 7 THEN 0 WHEN 8 THEN 1 ELSE 2 END::smallint AS payment_status,
      CASE WHEN n=9 THEN 2 ELSE 1 END::smallint AS payment_kind,
      CASE WHEN n=11 THEN '2026-11-01 00:00:00+07'::timestamptz ELSE NULL END AS settled_at
    FROM generate_series(1,13) n WHERE n<>10
  ), payment_methods AS (
    SELECT 'a0000000-0000-0000-0000-000000000001'::uuid AS id,' vnpay '::text AS code
    UNION ALL SELECT 'a0000000-0000-0000-0000-000000000002'::uuid,'FREE'
  ) `

test('SELECT-only production SQL preserves invoice identity, exact payment matching, actual billed services and UTC7 edges', { skip: !enabled }, async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const repository = new InvoicesRepository({ transaction: async (work) => work({
      query: (sql, values) => sql.startsWith('SET TRANSACTION')
        ? Promise.resolve({ rows: [] }) : client.query(`${fixtureSql}${sql}`, values),
    }) })
    const list = (query = {}) => repository.listInvoices(validateInvoiceListQuery(query))
    const all = await list({ limit: '25' })
    assert.equal(all.pagination.total, 12)
    assert.equal(all.items.length, 12)
    assert.equal(new Set(all.items.map((item) => item.id)).size, 12)
    assert.deepEqual(all.options.services.map((service) => service.id), [serviceA, serviceB])
    const item = (ordinal) => all.items.find((row) => row.id === fixtureId(1, ordinal))
    assert.deepEqual(item(1).services.map((service) => service.id), [serviceA, serviceB])
    assert.equal(item(1).hasUnlinkedLabor, true)
    assert.equal(item(1).hasUnlinkedService, false)
    assert.deepEqual(item(2).services, [])
    assert.equal(item(2).hasUnlinkedService, true)
    assert.equal(item(2).pdfUrl, null)
    assert.deepEqual(item(3).services.map((service) => service.id), [serviceB])
    assert.equal(item(3).hasUnlinkedLabor, true)
    assert.equal(item(4).hasUnlinkedLabor, false)
    assert.equal(item(12).hasUnlinkedLabor, true)
    for (const ordinal of [1, 9, 11, 12]) assert.equal(item(ordinal).paymentStatus, 'PAID')
    for (const ordinal of [2, 3, 4, 5, 6, 7, 8, 10]) assert.equal(item(ordinal).paymentStatus, 'UNRECORDED')
    assert.equal(item(9).amount, '0.00')
    assert.equal((await list({ status: 'PAID' })).pagination.total, 4)
    assert.equal((await list({ status: 'UNRECORDED' })).pagination.total, 8)
    const serviceFiltered = await list({ service: serviceB })
    assert.equal(serviceFiltered.pagination.total, 2)
    assert.ok(serviceFiltered.items.every((row) => row.amount === '100.00'))
    assert.deepEqual(serviceFiltered.options.services, all.options.services)
    const inactive = await list({ service: serviceA, limit: '25' })
    assert.equal(inactive.pagination.total, 10)
    assert.ok(inactive.items.every((row) => row.services.some((service) => service.id === serviceA)))
    const day = await list({ from: '2026-10-01', to: '2026-10-01', limit: '25' })
    assert.equal(day.pagination.total, 10)
    assert.equal(day.items[0].id, fixtureId(1, 2))
    assert.equal(day.items.at(-1).id, fixtureId(1, 1))
    assert.equal((await list({ from: '2026-10-02', to: '2026-10-02' })).items[0].id, fixtureId(1, 3))
    assert.equal((await list({ to: '2026-09-30' })).items[0].id, fixtureId(1, 4))
    const first = await list({ page: '1' })
    const second = await list({ page: '2' })
    assert.equal(first.items.length, 10)
    assert.equal(second.items.length, 2)
    assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 12)
    for (const search of ['%', '_', '\\', '0900000000']) assert.equal((await list({ search })).pagination.total, 12)
    assert.equal((await list({ search: "' OR 1=1 --" })).pagination.total, 0)
    assert.equal((await list({ search: 'SYNTHETIC-INV-12' })).items[0].id, fixtureId(1, 12))
    assert.equal((await list({ search: 'SYNTHETIC-BK-12' })).items[0].id, fixtureId(1, 12))
    const unused = await list({ service: unusedService })
    assert.equal(unused.pagination.total, 0)
    assert.ok(unused.options.services.some((service) => service.id === unusedService))
    await assert.rejects(list({ service: fixtureId(6, 999) }), { status: 422 })
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})

test('SELECT-only detail SQL preserves saved lines, exact decimals, guarded service links, completion actor and payment identity', { skip: !enabled }, async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const repository = new InvoicesRepository({ transaction: async (work) => work({
      query: (sql, values) => sql.startsWith('SET TRANSACTION')
        ? Promise.resolve({ rows: [] }) : client.query(`${fixtureSql}${sql}`, values),
    }) })
    const invoice = await repository.getInvoice(fixtureId(1, 1))
    assert.equal(invoice.paymentStatus, 'PAID')
    assert.deepEqual(invoice.totals, { subtotal: '112.34', partsAmount: '12.34', discountAmount: '12.34', totalAmount: '100.00' })
    assert.equal(invoice.items.length, 4)
    assert.equal(new Set(invoice.items.map((item) => item.id)).size, 4)
    assert.deepEqual(invoice.items.map((item) => item.itemType), ['SERVICE', 'SERVICE', 'SERVICE', 'LABOR'])
    assert.deepEqual(invoice.items.map((item) => item.service?.id ?? null), [serviceA, serviceA, serviceB, null])
    for (const item of invoice.items) {
      assert.equal(item.description, 'Stored invoice line description')
      assert.equal(item.quantity, '1.234')
      assert.equal(item.unitPrice, '60.00')
      assert.equal(item.totalPrice, '50.00')
      assert.equal(item.discountAmount, '3.00')
    }
    assert.equal(invoice.booking.address, 'Stored booking street, Stored ward, Stored city')
    assert.equal(invoice.booking.recipientName, 'Stored recipient')
    assert.equal(invoice.booking.scheduledEnd, null)
    assert.equal(invoice.booking.completedAt.toISOString(), '2026-09-30T04:00:00.000Z')
    assert.deepEqual(invoice.technician, { id: fixtureId(4, 10), name: 'Actual completing technician', phone: '0922222222' })
    assert.deepEqual(invoice.payments.map((payment) => payment.code), ['SYNTHETIC-PAY-13', 'SYNTHETIC-PAY-1'])
    assert.ok(invoice.payments.every((payment) => payment.method === 'VNPAY' && payment.amount === '100.00'))
    const foreign = await repository.getInvoice(fixtureId(1, 2))
    assert.equal(foreign.technician, null)
    assert.equal(foreign.booking.completedAt, null)
    assert.equal(foreign.pdfUrl, null)
    assert.ok(foreign.items.every((item) => item.service === null))
    const wrongType = await repository.getInvoice(fixtureId(1, 3))
    assert.deepEqual(wrongType.items.map((item) => item.service?.id ?? null), [serviceB, null])
    const linkedLabor = await repository.getInvoice(fixtureId(1, 4))
    assert.equal(linkedLabor.items[0].itemType, 'LABOR')
    assert.equal(linkedLabor.items[0].service.id, serviceA)
    for (const ordinal of [2, 3, 4, 5, 6, 7, 8, 10]) {
      const unmatched = await repository.getInvoice(fixtureId(1, ordinal))
      assert.equal(unmatched.paymentStatus, 'UNRECORDED')
      assert.deepEqual(unmatched.payments, [])
    }
    const free = await repository.getInvoice(fixtureId(1, 9))
    assert.equal(free.paymentStatus, 'PAID')
    assert.equal(free.payments[0].amount, '0.00')
    assert.equal(free.payments[0].method, 'FREE')
    assert.equal(free.payments[0].paidAt, null)
    assert.equal(await repository.getInvoice(fixtureId(1, 999)), null)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})

test.after(async () => { await pool.end() })
