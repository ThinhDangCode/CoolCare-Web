# Withdrawal read APIs (ThanhNT, STT 105)

`GET /api/admin/settlement/withdrawals` requires an Admin Bearer access token.

Query parameters:

| Parameter | Meaning |
| --- | --- |
| search | Literal substring of withdrawal UUID, technician name or phone; max 150 characters |
| status | ALL (default), PENDING, PROCESSING, SUCCESS, FAILED, CANCELLED |
| technician_id | UUID from technician_profiles.id |
| from_date / to_date | Optional inclusive calendar dates, YYYY-MM-DD, Asia/Ho_Chi_Minh; filters initiated_at |
| page | 1–1,000,000; default 1 |
| limit | 1–100; default 10 |

Response: `{ data: { items, total, page, limit } }`, newest initiated_at first,
then UUID descending to keep pagination order stable. Total is the filtered count.
An empty result returns items=[] and total=0.

Items include id, technician_id, technician_name, technician_phone, amount,
fee_amount, net_amount, bank_name, status, initiated_at, current_settlement_balance.
PostgreSQL NUMERIC amounts remain decimal strings; unknown fee/net amount remain
null. Current settlement balance is not the balance at request creation.

Count and rows run in one repeatable-read, read-only transaction. No account,
withdrawal, ledger, schema or trigger changes are made. No artificial WD codes.

## Withdrawal detail

`GET /api/admin/settlement/withdrawals/:id` requires the same Admin token.
`id` must be a UUID; malformed values return 422. A valid ID with no matching
withdrawal returns 404 with `WITHDRAWAL_NOT_FOUND`.

Response: `{ data: withdrawal }`. The flat object includes:

- id, technician_id, technician_account_id, technician_name, technician_phone,
  technician_email;
- amount, fee_amount, net_amount, bank_name, account_number, account_holder,
  status, initiated_at, processed_at, paid_at, payout_reference, failure_reason,
  note;
- current_settlement_balance, reserved_amount, available_balance and read_at;
- settlement_transactions: the ledger entries linked to this withdrawal and its
  account, sorted oldest first; each has id, transaction_type, amount,
  balance_before, balance_after, reference_type, reference_id, description,
  created_at.

All PostgreSQL NUMERIC amounts remain decimal strings. Missing fee/net amounts
remain null. reserved_amount is the sum of amounts from **all PENDING and
PROCESSING requests for the account**, including the request being viewed if
it is still active. available_balance equals current_settlement_balance minus
reserved_amount. These are the account's current values in the read snapshot,
not historical balances at request creation. read_at identifies that snapshot.

Detail, reserved amounts and ledger are read within one repeatable-read,
read-only transaction. Timestamps and ledger provide only the events actually
stored in the existing schema; the API does not fabricate state history or an
operator identity. No approve, reject, payout or other mutation endpoints exist.

Run `node --test tests/settlement.test.js` from backend for focused validation
and route tests. Set `RUN_SETTLEMENT_DB_TESTS=1` to additionally verify existing
local PENDING/SUCCESS fixtures, current balances and related ledger, and confirm
that financial tables remain unchanged. This integration check only reads data.
