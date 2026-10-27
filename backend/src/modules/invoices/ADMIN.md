# STT124/125 — Admin invoice list, detail and PDF download

`GET /api/admin/invoices` requires an Admin access token. The router sends
`Cache-Control: no-store` before authentication, including error responses.
`GET /api/admin/invoices/:id` also requires Admin and uses the same no-store rule.
`GET /api/admin/invoices/:id/pdf` generates an A4 service-invoice PDF from the
same saved invoice data. Invoice issuance, refunds, email delivery and all
financial mutations remain outside these features.

Query: `search` (literal, at most 150 characters), `status`
(`ALL|PAID|UNRECORDED`), `service` (`ALL|UUID`), optional inclusive `from` / `to`
(`YYYY-MM-DD`, invoice `issued_at` in UTC+7), `page` (1–1,000,000) and `limit`
(`10|25|50`, default 10). Unknown, repeated or malformed values return 422.
Known unused services remain selected and return no rows; unknown IDs return 422.

The result contains `items`, `pagination`, and global billed-service
`options.services`, independent of the active filters. A repeatable-read,
read-only transaction gives the options, count and page one consistent snapshot.
Each invoice is one row, even when it has multiple lines or payment attempts.
Money remains an exact PostgreSQL decimal string, never a JavaScript float.

`PAID` means there exists a SUCCESS payment matching invoice booking, customer,
and total amount. Settlement date is irrelevant, and successful FREE payments
count. Otherwise the derived status is `UNRECORDED` (“Chưa ghi nhận thanh toán”),
which is not a persistent invoice lifecycle or a refund state.

Services are resolved from invoice items' actual booked-service reference, guarded
to the invoice's booking, or their SERVICE quotation item's service, also guarded
to that booking. A LABOR line with no linked booked service stays unclassified;
the line description never supplies a guessed service. Invalid SERVICE references
are reported separately. Duplicate services are collapsed; inactive referenced
services remain visible. Filtering by service never prorates the invoice amount.

The list response allowlist omits email, addresses, provider/idempotency secrets
and invoice detail lines. PDF links must be absolute HTTP(S), without embedded
credentials or control/space characters; unsafe values become null. No remote
PDF is fetched by the server. Successful read audits contain filter presence,
pagination and counts, without raw search, customer identities or money values.

## Invoice detail (STT125)

The path ID must be one scalar UUID (normalized to lowercase); malformed IDs
return 422. A valid missing ID returns 404 `INVOICE_NOT_FOUND`. The detail read
uses one repeatable-read, read-only transaction and returns `{ success: true,
data }`, where `data` contains:

- `id`, `invoiceNumber`, `issuedAt`, `paymentStatus`, sanitized `pdfUrl`.
- `customer`: profile `id` and current user `name` / `phone`. The database does
  not store frozen customer identity on the invoice; do not describe these as
  immutable billing identity snapshots.
- `booking`: `id`, `code`, booking-snapshot `address`, `recipientName`,
  `recipientPhone`, `scheduledStart` (`scheduled_at`), `scheduledEnd: null`
  because no scheduled-end column exists, and `completedAt` (`completed_at`).
- `technician`: profile `{ id, name, phone }` resolved only from the booking's
  immutable `technician_completed_by_id` user, or null. Current assignments,
  payment technicians and quotation authors are not completion evidence.
- `totals`: exact stored strings `subtotal`, `partsAmount`, `discountAmount`,
  `totalAmount`. Parts are already included in subtotal. No values are
  recomputed, no parts are added again and no line discount is subtracted twice.
- `items`: stored invoice-item `{ id, itemType, description, quantity, unit,
  unitPrice, totalPrice, discountAmount, service }`. Decimal values, including
  quantity, remain strings inside JSON. `service` is `{ id, name }` or null,
  resolved using the same booking guards as the list. Description, quantity,
  unit, prices and discounts always come from the invoice item, never from
  current catalog/quotation prices. Items are ordered by ID because no stored
  invoice-line sequence exists. Parts have only an aggregate amount; no
  individual parts or synthetic invoice lines are invented.
- `payments`: `{ id, code, method, amount, paidAt }` for every SUCCESS attempt
  matching booking, customer and exact invoice total, ordered by `paid_at DESC
  NULLS LAST, id DESC`. The same predicate derives the list/detail PAID status;
  zero-value FREE and unsettled successes count. Other attempts are omitted.
  Multiple successes remain separate evidence, never summed as paid money.

Detail reads record `READ_DETAIL` audits with invoice ID and derived status only;
customer, recipient, address, line items, money and payment/provider secrets are
excluded from the audit. Invalid, absent and failed reads produce no successful
read audit. A stored PDF URL is exposed if safe for existing consumers. The PDF
download endpoint generates a fresh representation and neither fetches nor
changes the stored link.

## Invoice PDF

`GET /api/admin/invoices/:id/pdf` requires the same Admin token as list/detail.
The path accepts one scalar UUID; malformed IDs return 422 and a valid absent ID
returns 404 `INVOICE_NOT_FOUND`. This endpoint accepts no query parameters; any
unknown or repeated parameter returns 422 before reading the invoice. Download
does not issue a new invoice or change payment status, `pdf_url`, totals or any
other database record.

The service performs one existing repeatable-read, read-only detail query and
passes the allowlisted result to the PDF renderer. The renderer returns a Buffer
in memory; no generated PDF is persisted to server files or remote storage.
Success responds with `application/pdf`, an attachment `Content-Disposition`
including a sanitized ASCII fallback and UTF-8 filename, `Content-Length`,
`X-Content-Type-Options: nosniff` and `Cache-Control: no-store`. The filename is
based on the invoice number, bounded and stripped of path/header controls.
Content-Disposition is exposed to the web client for authenticated blob download.
Errors remain JSON and never carry successful PDF attachment headers.

PDF layout follows the approved CoolCare service-invoice Figma template: A4,
white/orange, provider/customer/payment information, grouped service/labor lines,
aggregate parts and saved totals. The document uses Vietnamese text and local
UTC+7 dates. Service date is the booking's actual `completedAt`; absence is
shown as unavailable rather than replaced with the scheduled or issue date.
Provider address/hotline stay blank until real business details are configured;
the document does not invent a tax code, tax rate or electronic-tax-invoice
registration. It is a system service invoice, not a declared VAT invoice.

Money comes from stored exact decimal strings. Parts already belong to subtotal;
they are shown separately without being added twice. The existing grouping rule
combines only compatible service/labor snapshots and preserves quantities,
line totals and discounts. Matching successful payments establish PAID status;
duplicate successes are never summed. A PAID invoice shows its stored total as
paid and zero remaining; an UNRECORDED invoice shows paid/remaining as
`Chưa xác định`, without claiming that the customer owes the invoice total.

Successful generation records one `EXPORT_PDF` audit containing invoice ID,
derived payment status and byte length only; it does not also log READ_DETAIL.
Customer identity, addresses, lines, money, payment/provider values and document
number are excluded. Invalid/missing reads and render failures produce no
successful export audit. Unexpected render failures return 500
`INVOICE_PDF_FAILED` with a safe message.

Run unit/integration route tests with
`node --test tests/admin-invoices.test.js tests/admin-invoices.pdf.test.js`.
Optional SELECT-only SQL fixture coverage:
`RUN_INVOICES_DB_TESTS=1 node --test tests/admin-invoices.database.test.js`.
These tests use CTEs in a read-only transaction and create no database records.
They cover both list regressions and detail snapshots, service guards, completion
actor, decimal precision, duplicate successes and nonmatching/FREE payments.
