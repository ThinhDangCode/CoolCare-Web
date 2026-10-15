# Admin top-up history (STT120)

Admin can read all technician top-ups, including PENDING, PROCESSING, SUCCESS,
FAILED and CANCELLED. The primary source is technician_topups, not the success-only
ledger. No creation, provider callback, approval, funding or status/amount mutation
is performed. Database triggers already own verified top-up credit posting.

- `GET /api/admin/topups` returns `{success:true,data:{items,pagination,options}}`.
- `GET /api/admin/topups/:id` returns `{success:true,data:{...detail}}`.
- Both require an Admin access token and return `Cache-Control: no-store`.

## List parameters and dynamic methods

| Query     | Accepted values                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| page      | Integer 1–1,000,000, default 1                                                                                    |
| limit     | Integer 1–100, default 10                                                                                         |
| search    | Literal top-up UUID/code, provider transaction reference, technician name/phone substring, at most 150 characters |
| status    | ALL (default), PENDING, PROCESSING, SUCCESS, FAILED, CANCELLED                                                    |
| method    | ALL (default) or a known payment-method UUID                                                                      |
| from / to | Optional real YYYY-MM-DD dates, years 0001–9999, inclusive                                                        |

Unknown/repeated/malformed values, unknown method UUIDs and reversed ranges return
422 VALIDATION_ERROR. Detail has a validated UUID and accepts no query parameters;
missing detail returns 404 TOPUP_NOT_FOUND.

Date filters apply to created_at using fixed UTC+7 calendar days, not paid_at or
settled_at. Ordering is created_at DESC, id DESC. Search values are bound, and
%, _ and backslash are literal, never SQL LIKE wildcard operators from the user.

options.methods contains {id,code,name} from methods actually used anywhere in
top-up history, including inactive methods and transactions outside the selected
date/status filters. Nothing is hardcoded to VNPay or ZaloPay. A known but unused
method is also valid: it returns zero rows and is included in options when selected
so the active filter remains representable. Options, count and page rows share one
repeatable-read/read-only transaction. Method labels reflect the current catalog;
the database has no per-top-up frozen method-name snapshot.

Each list item has id, topupCode, technician {id,name,phone}, amount, method
{id,code,name}, status, transactionReference, createdAt, paidAt and settledAt.
Amount is the exact PostgreSQL numeric string; null timestamps/provider references
remain null. No internal idempotency keys or account balances are exposed.

## Detail and reconciliation

Detail adds closureVerifiedAt, closureReference and optional ledger
{id,type,amount,balanceBefore,balanceAfter,createdAt,referenceId}. Closure values
are stored evidence of a definitively unpaid failure or cancellation, not a new
failure-reason field inferred from provider references or a timeout.

SUCCESS credits the full top-up amount through the existing trigger. The ledger
join requires topup_id, TOP_UP type, the same account, account ownership matching
the technician and SUCCESS status. Non-success rows stay visible but unposted.
Missing or mismatched ledger is null. Historical ledger values are returned
exactly as stored, never recreated from the current settlement balance.
settledAt indicates top-up posting, not completion of a weekly settlement or debt
clearance. This module does not initiate payments, reconcile with a real provider,
update money/status, send notifications or change schema/seed.

Successful READ_LIST/READ_DETAIL events use the existing management logger with
actor, entity ID, status, filter-presence/date/pagination/count metadata only.
Raw search, technician data, provider/closure references and money are not logged.

Run `node --test tests/topups.test.js`. Set `RUN_TOPUPS_DB_TESTS=1` and run
`node --test tests/topups.database.test.js` for existing local fixtures and
SELECT-only synthetic CTE fixtures. They verify date boundaries, inactive methods,
all statuses, nullable fields and owner/type/account ledger isolation without any
inserts, updates, deletes or schema changes, and compare financial table checksums.
