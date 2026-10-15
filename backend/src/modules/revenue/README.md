# Platform commission report (STT118)

`GET /api/admin/revenue` is Admin-only and read-only. It returns
`{ success: true, data: { period, filters, options, summary, trend, services, areas, warnings } }`
with `Cache-Control: no-store`.

| Query   | Accepted value                                         |
| ------- | ------------------------------------------------------ |
| period  | MONTH (default), QUARTER, YEAR                         |
| year    | Required integer, 1900–9999                            |
| month   | Required 1–12 only for MONTH                           |
| quarter | Required 1–4 only for QUARTER                          |
| service | ALL, a known service UUID, UNCLASSIFIED or UNALLOCATED |
| area    | ALL or a canonical city ID returned by options.areas   |

Unknown/repeated parameters, invalid periods/IDs/options and incompatible month/quarter
parameters return 422 VALIDATION_ERROR. Previous periods can fall in 1899 internally.
All boundaries use fixed UTC+7 and include the selected final calendar day.

## Confirmed money and period policy

Revenue is **only the stored payments.commission_amount**, for SUCCESS payments with
settled_at recorded. Customer amount, voucher discount, technician entitlement,
top-ups, withdrawals and account/settlement balances do not supply this revenue.
No current price or commission rate is used to recalculate the payment total.
The comparison is the immediately preceding period of the same type. Calendar
averages divide by 1/3/12 months, including zero-revenue months. Percentage change
is unavailable when previous revenue is zero or either complete total is unknown.

MONTH trend compares ordinal days and includes the longer of the two months;
a nonexistent day is null, a valid day with no payments is "0.00". QUARTER/YEAR
compare 3/12 ordinal monthly buckets. Missing commission remains unknown/null,
with a separate knownRevenue/knownAmount and explicit warnings.

## Service allocation and area attribution

Each payment's approved SERVICE and LABOR pre-discount line totals are grouped by
quotation_items.service_id, or the linked booking_unit_service's service_id when
that unit belongs to the same booking. Unlinked labor/service goes to UNCLASSIFIED.
Parts are excluded. The approved line sum must equal the saved positive
commission_base_amount; missing, zero, invalid or mismatched bases send the entire
known commission to UNALLOCATED rather than inventing a service attribution.

Allocation distributes the saved commission's cents proportionally to the groups.
PostgreSQL exact numeric div/mod calculates integer floors and remainders. Remaining
cents go to highest remainders, with service ID C collation as a deterministic tie
breaker. Allocations sum exactly to the authoritative commission snapshot.
No JavaScript floating-point money summation is used.

The service filter selects the allocated service share, not all of the booking's
commission. If unallocated payments exist, they may contain the chosen service;
the selected-service total is null and knownRevenue explicitly remains partial.
paymentCount includes contributing payments and those uncertain payments.
Selecting ALL still includes known UNALLOCATED commission in the full total.

Areas use stored bookings.city, never technician coverage zones or current customer
addresses. Whitespace/case are normalized, with common aliases for Hồ Chí Minh,
Hà Nội, Đà Nẵng and Cần Thơ merged. Missing cities use UNKNOWN_AREA / Unknown area.
Inactive/historical services stay selectable; the two diagnostic service buckets
also remain selectable across empty periods. Names reflect the current service
catalog because there is no frozen per-service name/allocation table.

## Integrity and verification

Options and all report aggregates share one repeatable-read/read-only transaction.
Aggregation runs over the full period in PostgreSQL, without sampling, pagination
or the export endpoint's 10,000-row limit. Query values are bound parameters.
Successful reads emit READ_REPORT to the existing management logger, containing
actor, period, dates, filter-presence flags and count only. No financial or customer
fields are written to audit. No payment, ledger, account, schema or seed is changed.

Run `node --test tests/revenue.test.js`. Set `RUN_REVENUE_DB_TESTS=1` to run
`node --test tests/revenue.database.test.js` against existing local data. Database
tests compare table checksums and exercise the real query using SELECT-only VALUES
and generate_series fixtures; they never insert, update, delete or migrate data.
