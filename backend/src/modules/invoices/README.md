# Invoices (STT 52 — View And Download Invoice)

Customer-only endpoints, mounted under `/api/payments` (before the existing payment router):

| Method | Path | Result |
|---|---|---|
| GET  | `/:paymentId/invoice` | Invoice document (JSON) |
| GET  | `/:paymentId/invoice/pdf` | PDF download (`application/pdf`, attachment) |
| POST | `/:paymentId/invoice/email` | Sends the PDF to the account email (max 3 per 15 min per user) |

Errors: `401` no/invalid token, `403` not a customer, `422 INVALID_ID`, `404 PAYMENT_NOT_FOUND`
(also for other people's payments), `409 INVOICE_NOT_AVAILABLE` (payment not SUCCESS),
`404 INVOICE_NOT_FOUND` (no row in `invoices` for this payment), `429 INVOICE_EMAIL_RATE_LIMITED`
(+`Retry-After`), `422 EMAIL_REQUIRED`, `503 EMAIL_NOT_CONFIGURED`.

## Automatic email after payment
`dispatchPendingEmails()` emails every SUCCESS payment (last 3 days) that has an invoice and no
"Hóa đơn đã được gửi qua email" notification yet, then records that notification (this is the
de-duplication key; no schema change). It runs right after cash confirmation, gateway
callbacks/returns and free bookings, plus a 60 s safety-net worker started in `server.js`.
Requires SMTP (`SMTP_HOST/USER/PASSWORD/FROM`); without it nothing is sent automatically.

## Company details on the invoice (optional env)
`COMPANY_NAME` (default CoolCare), `COMPANY_ADDRESS`, `COMPANY_HOTLINE`, `COMPANY_TAX_CODE`.
When address/hotline are empty the invoice shows the design's placeholders and "Thông tin chờ cấu hình".

## PDF
Generated in `pdf/` without extra npm packages (own writer + TrueType subsetter). Fonts:
`assets/fonts/LiberationSans-*.ttf` (SIL OFL). Layout follows the Figma frame.
