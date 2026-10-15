# Admin withdrawal history (STT119)

Admin reads all technician-initiated withdrawals, including PENDING, PROCESSING,
SUCCESS, FAILED and CANCELLED. This is not an approval queue or a ledger-only list.
No schema, provider, account, ledger, amount or status is changed by these endpoints.

- `GET /api/admin/withdrawals` returns `{success:true,data:{items,pagination}}`.
- `GET /api/admin/withdrawals/:id` returns `{success:true,data:{...detail}}`.
- Both require an Admin access token and return `Cache-Control: no-store`.

## List filters

| Query     | Accepted values                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------ |
| page      | Integer 1–1,000,000, default 1                                                                         |
| limit     | Integer 1–100, default 10                                                                              |
| search    | Literal withdrawal UUID / payout reference / technician name / phone substring, at most 150 characters |
| status    | ALL (default), PENDING, PROCESSING, SUCCESS, FAILED, CANCELLED                                         |
| from / to | Optional real YYYY-MM-DD dates, years 0001–9999, inclusive                                             |

Unknown/repeated/malformed values and reversed ranges return 422 VALIDATION_ERROR.
Filters apply to **initiated_at** using fixed UTC+7 calendar days, not processed_at,
paid_at or ledger posting time. Stable ordering is initiated_at DESC, id DESC.
Count and page rows share one repeatable-read/read-only transaction. Search uses
bound parameters, and %, _ and backslash are escaped as literal characters.

Each list item contains id, payoutReference, technician {id,name,phone}, amount,
feeAmount, netAmount, status, initiatedAt, processedAt and paidAt. Bank information,
notes, failure reasons and internal idempotency keys are not included in list rows.
There is no separate human withdrawal_code in the database; no WD001 code is invented.

## Detail and financial meaning

The detail adds bank {name,accountNumber,accountHolder}, failureReason, note and
optional ledger {id,type,amount,balanceBefore,balanceAfter,createdAt,referenceId}.
Only authenticated Admin detail reveals the stored destination. Account numbers
remain strings so leading zeroes survive. All money uses PostgreSQL numeric strings;
NULL fee/net amounts mean unknown and are never converted to zero.

The requested amount already includes the provider fee. For example amount 100000,
fee 5000 means net bank payout 95000. SUCCESS records one ledger debit of -100000,
not -105000 and not -95000. netAmount is read from the generated database column.
The database's payout lifecycle and success trigger already own reservations and
money posting; this module never calls them or recreates their writes.

Ledger is optional: PENDING/PROCESSING reserve money but have no posted payout debit.
The join requires withdrawal_id, WITHDRAWAL type, the same technician account and
account ownership matching the withdrawal technician. Missing/mismatched ledger
is returned as null rather than substituted from current account balances.
Historical balance_before/after and references are returned exactly as stored.
processedAt/paidAt, payoutReference and failureReason are nullable where not recorded.
Missing detail returns 404 WITHDRAWAL_NOT_FOUND; malformed UUID or detail query
parameters return 422. There are no POST/PATCH/DELETE/approval/reject/top-up routes.

Successful READ_LIST/READ_DETAIL events use the existing management logger with
actor, entity ID, status, filter presence/date/pagination/count metadata only.
Search text, money, bank details, technician/customer information and notes are not logged.

Run `node --test tests/withdrawals.test.js`. Set `RUN_WITHDRAWALS_DB_TESTS=1` and run
`node --test tests/withdrawals.database.test.js` for existing local fixtures and
SELECT-only synthetic CTE fixtures, including historical owner-join checks.
Database checks compare financial table checksums and never change data.
