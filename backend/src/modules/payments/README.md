# Admin payment list and detail (ThanhNT, STT 116/117)

Mount `createPaymentsRouter()` at `/api/admin/payments`.
`GET /api/admin/payments` requires an Admin Bearer access token.

| Query parameter | Meaning |
| --- | --- |
| search | Literal, case-insensitive substring of payment code/UUID, booking code, customer name/phone; maximum 150 characters |
| status | ALL (default), PENDING, PROCESSING, SUCCESS, FAILED, CANCELLED |
| method | ALL (default), CASH, VNPAY, ZALOPAY, FREE |
| from / to | Optional inclusive calendar dates, YYYY-MM-DD, year 0001–9999, Asia/Ho_Chi_Minh; filters payments.created_at |
| page | 1–1,000,000; default 1 |
| limit | 1–100; default 10 |

Malformed/repeated parameter values, impossible dates or a reversed date range
return 422 through the shared error handler. Dates include the whole Vietnam
calendar day, using a next-day exclusive bound for `to`.
Successful list responses have `Cache-Control: no-store`.

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "payment-uuid",
        "paymentCode": "PAY001",
        "bookingCode": "BK001",
        "customerName": "Customer name",
        "customerPhone": null,
        "amount": "200000.00",
        "methodCode": "VNPAY",
        "methodName": "VNPay",
        "status": "SUCCESS",
        "createdAt": "2026-10-13T00:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
  }
}
```

Rows are payment attempts, including failed/cancelled attempts for a booking;
they are not grouped by booking. Sorting is created_at descending, then UUID
descending. Empty results have items=[], total=0, totalPages=0. Amount remains a
PostgreSQL NUMERIC decimal string. Customer phone remains null when not recorded.
Customer joins through payments.customer_id → customer_profiles.id → users.id.
Date filters use request creation time, not successful payment time.

Count and rows share a repeatable-read, read-only transaction. No balance,
payment, ledger, schema or seed changes occur. Successful authorized reads emit
the existing ADMIN_AUDIT structured log with action READ_LIST and entityType
PAYMENT. Metadata excludes search text, customer data, amounts and credentials.
This is a deployment log, not a new persistent audit/history table.

## Payment detail

`GET /api/admin/payments/:id` uses the same Admin guard. A malformed UUID returns
422; a valid missing UUID returns 404 with `PAYMENT_NOT_FOUND`. The success
response is `{ success: true, data: payment }` with `Cache-Control: no-store`.

The detail object's fields are:

- id, paymentCode, status, amount, methodCode, methodName, kind,
  transactionReference, createdAt, updatedAt, paidAt, settledAt, cashReceivedAt,
  closureVerifiedAt, closureReference;
- commissionRate, commissionBaseAmount, commissionAmount,
  platformDiscountAmount, technicianEarning, readAt;
- booking: id, bookingCode, status, scheduledAt, description, recipientName,
  recipientPhone, serviceAddress, ward, district, city, technicianCompletedAt,
  completionConfirmedAt, completedAt, customerConfirmedCompletion;
- booking.totals: subtotal, discountAmount, totalAmount, partsAmount,
  quotationSubtotal, itemServiceLaborTotal;
- booking.pricingMatchesPayment, quotationTotalsMatchBooking,
  itemBreakdownMatchesQuotation: nullable SQL reconciliation booleans;
- booking.quotations: accepted quotation id, number, type, subtotal, partsAmount,
  laborAmount, discountAmount, totalAmount, respondedAt;
- booking.items: accepted quotation item id, quotationId, itemType, description,
  quantity, unit, unitPrice, totalPrice, discountAmount;
- customer: id, userId, name, phone, email, avatarUrl, completedBookingCount;
- technician: null or id, userId, name, phone, email, avatarUrl, ratingAverage,
  totalReviews, serviceZones (city/district/ward);
- ledger: actual linked entries with only id, transactionType, amount, createdAt;
- invoice: null or id, invoiceNumber, pdfUrl, issuedAt, totalAmount.

Money, rate, quantity and rating values remain PostgreSQL decimal strings or null;
timestamps serialize as ISO strings. No current service catalog price is used.
Amounts on the payment are that attempt's frozen financial snapshot. The booking
totals/line items are the current booking's accepted quotation records and must be
labeled separately: a failed attempt can precede later repricing. Missing accepted
quotations/lines retain unknown (null) aggregates, not invented zero breakdowns.
The reconciliation flags identify stored inconsistencies; they do not recalculate
or overwrite any prices, nor assert that line sums are a verified paid receipt.

Technician identity comes exclusively from payments.technician_id. A null value
does not borrow a current booking assignment. Ledger entries additionally must
belong to that technician's account. ONLINE_EARNING is credit evidence;
CASH_SETTLEMENT is a signed movement, not automatically a payout/credit. The
positive technicianEarning entitlement alone is not evidence of an account credit.

Invoices have booking_id rather than payment_id. Detail returns an invoice only
for a SUCCESS attempt with matching customer and total. The schema's unique live
attempt constraint permits at most one successful payment per booking. Unpaid
attempts never borrow an invoice from another attempt. pdfUrl is available only
when the stored value is an absolute HTTP(S) link without embedded credentials;
missing/unsafe values remain null. The endpoint does not generate or send PDFs.

Customer completedBookingCount counts COMPLETED bookings, not successful payments.
customerConfirmedCompletion verifies the stored completion timestamp and customer
actor; it does not prove an on-site signature. district is nullable across the two
provided schemas, using only the actual stored column if present. No VAT, VIP tier,
30% payout share, gateway fee, refund, webhook event or full payment state timeline
is fabricated from Figma samples or unrelated tables.

Every detail query runs within the same repeatable-read, read-only transaction.
Successful reads log READ_DETAIL with actor/payment/booking IDs and status only.
Idempotency keys, passwords, bank credentials and account balances are not exposed.

## Revenue report export (STT 115)

`GET /api/admin/payments/export` runs before the UUID detail route and requires
the same Admin token. Query parameters are only:

| Parameter | Meaning |
| --- | --- |
| from / to | Required real calendar dates YYYY-MM-DD, years 1900–9999, inclusive |
| method | ALL (default), CASH, VNPAY, ZALOPAY, FREE |
| search | Optional literal substring of payment code/UUID, booking code, customer name/phone, up to 150 characters |

Repeated/malformed values, unknown parameters, status/page/limit and reversed
dates return 422 `VALIDATION_ERROR`. This report includes only SUCCESS payments
with paid_at recorded. Its period uses **paid_at**, unlike the list's created_at
filter. Boundaries use fixed UTC+7 throughout the supported calendar to match the
confirmed report policy; historical IANA timezone offset changes are not applied.

Count, SQL exact monetary sums, known/missing counts and sorted rows run in one
repeatable-read/read-only transaction. More than 10,000 results returns 422
`REPORT_TOO_LARGE` before fetching detail rows; no partial/truncated file is sent.
The report includes each successful payment attempt once, newest paid_at/id first.
KTV identity comes only from that payment's technician_id, with optional left joins.
Current assignments or service prices never supply report money or identity.

The response is a real XLSX with:

- Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
- Content-Disposition: attachment; filename="coolcare-revenue-{from}-{to}.xlsx"
- Cache-Control: no-store
- X-Report-Row-Count: the full exported count
- Access-Control-Expose-Headers: Content-Disposition, X-Report-Row-Count (export only)

**Revenue Summary** lists selected period/filter, UTC+7 timezone, generated time,
row count and monetary metrics. Gross successful payment amount is the primary
total. Stored commission, platform-funded discount and technician entitlement
snapshots are separate metrics, not calculated net platform revenue. Each metric
shows complete total, known rows, missing rows, explicitly known-value sum and
completeness. If snapshots are missing the total remains blank; missing money is
never coerced to zero. Zero results are a valid header/summary report with count
and complete sums of zero.

**Paid Payments** contains payment UUID/code, booking code, customer name/phone,
payment technician name, method code/name, status, gross amount, commission,
platform discount, technician entitlement, created/paid/settled dates and payment
kind. No bank details, JWT/password, idempotency key or account balances appear.
All text is stored as literal Excel strings, including formula-like prefixes;
there are no generated formulas or hyperlinks. Phones keep leading zeroes.

ExcelJS 4.4.0 builds the workbook using its documented writeBuffer/cell-value APIs
([official documentation](https://github.com/exceljs/exceljs#writing-xlsx)). Individual
14-digit NUMERIC snapshots fit numeric Excel cells. Values above 15 minor-unit
digits are conservatively preserved as decimal text rather than losing any digits.
SQL SUM computes totals; no floating-point accumulation occurs in JavaScript.
Date cells intentionally represent fixed UTC+7 wall-clock time and are labelled
accordingly. Early dates before 1900-03-01 and out-of-range dates stay labelled
text because of Excel's fictional 1900 leap day/calendar limitations.

EXPORT audit logs only actor, period, method, hasSearch and count, after workbook
generation succeeds. It does not log search text, customer data or amounts. No
schema, seed, payment status, balance, ledger or other feature's rules are changed.

Run `node --test tests/payments.export.test.js`. Set
`RUN_PAYMENT_EXPORT_DB_TESTS=1` to run tests/payments.export.database.test.js against
existing local fixtures without changing any database data.

No PDF generation, refund or mutation endpoint is included.
Run `node --test tests/payments.test.js` from backend for focused tests.
`RUN_PAYMENTS_DB_TESTS=1 node --test tests/payments.database.test.js` additionally
verifies existing local fixtures without changing database data.
