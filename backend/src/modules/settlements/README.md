# STT126 — Admin technician settlement viewing

This module only reads existing weekly settlement periods and their ledgers.
There are no create, close, payout, adjustment, CSV or PDF endpoints. It never
changes financial rows or starts a scheduler. No database migration is needed.

`GET /api/admin/settlements` accepts `search` (literal, at most 150 characters),
`status` (`ALL|OPEN|CALCULATED|SETTLED|OVERDUE`), optional inclusive calendar dates
`from` / `to` (`YYYY-MM-DD`, selecting **period_start** in UTC+7), `page`
(1–1,000,000), and `limit` (`10|25|50`, default 10). The backend defaults to all
time. Unknown, repeated and malformed parameters return 422. Searches match
settlement code, technician profile UUID, current user name and phone.

Each item contains `id`, `code`, `technician: {id,name,phone,avatarUrl}`,
`period: {start,end}`, `status`, `finalizedAt`, `dueAt`, and `totals` containing
`openingBalance`, `cashSettlement`, `onlineEarning`, `topup`, `withdrawal`,
`adjustment`, `closingBalance`, `debtAmount`, and `debtRemainingAmount`. Period
timestamps use the stored Monday-start / next-Monday-exclusive weekly bounds;
clients display the final included Sunday. Unsafe avatar URLs become null.

List results contain `items`, `pagination`, `summary`, and `readAt`. Summary
contains `totalPeriods`, `openPeriods`, `owingPeriods` (CALCULATED or OVERDUE),
`settledPeriods`, and `remainingDebt`. It covers the entire filtered result,
independent of pagination. An empty result has debt `0.00`; a result consisting
only of OPEN periods has debt null. All dates, counts, rows, summary and live
debt are read from one repeatable-read, read-only transaction. `readAt` is its
database `transaction_timestamp()`.

`GET /api/admin/settlements/:id` accepts only `transactionsPage` and
`transactionsLimit`, with the same pagination bounds. Invalid UUIDs return 422;
missing periods return 404 `SETTLEMENT_NOT_FOUND`. The result extends a list item
with `readAt`, `income`, and `transactions: {items,pagination}`. Each transaction
contains `id`, `createdAt`, `type`, `description`, signed `amount`,
`balanceBefore`, `balanceAfter`, and `source` (null or `{type,id,code}`). Types
are CASH_SETTLEMENT, ONLINE_EARNING, TOP_UP, WITHDRAWAL and ADJUSTMENT. Source
types are PAYMENT, TOP_UP and WITHDRAWAL; a withdrawal has no public stored code,
so its source code is null. Source joins verify the technician/account owner.
Provider data, bank account details, reference IDs and idempotency keys are not
included. Transactions are stably sorted newest first, then descending UUID.

## Financial interpretation

- Frozen header money comes from `settlements`; live debt and effective status
  come from `settlement_debt_balances`, with explicit local numeric-code decoding.
  Stored status is never used to infer current debt. SETTLED means no debt
  remains for that period; it does not mean a positive balance was paid out.
- OPEN header money and income are null. Its stored default zeroes are not
  finalized facts. Its detail ledger is live, within the exact account and
  half-open weekly bounds. Finalized ledger rows must also belong to the frozen
  `settlement_items`; rows from another account, week or missing membership are
  excluded.
- Closing balance = opening + signed cash movement + online earning + topups
  - withdrawals + signed adjustments. Commission and withdrawal fees must not
  be subtracted again. Cash movement may be negative, positive or zero.
- A negative historical closing balance may contain previous debt. It is never
  treated as this period's live remaining debt. Later positive credits of any
  kind can repay debt, using the database view's FIFO allocation.
- `income` contains exact decimal-string `technicianEarning` and
  `commissionAmount`, plus `matchedPayments` and `unavailablePaymentCount`.
  These explanatory totals cover the entire period, independent of transaction
  pagination. Unique SUCCESS payment snapshots must have a finalized snapshot,
  the correct technician, kind and complete nonnegative financial snapshots,
  and exactly explain their ledger delta: CASH = platform discount - commission;
  ONLINE/FREE = technician earning. Successful FREE payments and zero ledger
  movements remain valid. A payment is summed only once even if a legacy ledger
  has duplicate references. A missing/invalid payment-linked movement makes both
  income amounts null, with the unavailable row count exposed. No payment
  movements means known `0.00`, not unknown. OPEN counts and amounts are null.
  Income is explanatory and is never added to the header balance again.

Both endpoints require Admin authentication and send `Cache-Control: no-store`
before authentication, including error responses. Successful `READ_LIST` and
`READ_DETAIL` audit events contain only filter presence, status, pagination,
counts and entity IDs, without raw searches, names, phone numbers or money.

Run `node --test tests/settlements.test.js` for validation, SQL contract,
repository, audit and HTTP authorization checks. Optional PostgreSQL coverage:
`RUN_SETTLEMENTS_DB_TESTS=1 node --test tests/settlements.database.test.js`.
It executes exported production SQL with SELECT-only CTEs in a read-only
transaction and writes no schema or fixture records. Coverage includes the real
FIFO debt-view expression, effective status changes, full-filter summary,
pagination, UTC+7 boundaries, literal searches, owner guards, OPEN unknowns,
frozen membership, exact decimals, duplicate payment references, valid FREE and
zero payment movements, and 13 invalid-payment evidence cases.
