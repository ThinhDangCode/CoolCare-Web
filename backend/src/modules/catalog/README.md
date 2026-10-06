# Service & AC catalog

Uses the existing `service_categories`, `ac_brands`, `services` and `ac_models` tables. No migration or new table is required. Record details show the existing `created_at` and `updated_at` columns; these timestamps are not a complete change history and do not identify the actor or previous values. The existing database has no general catalog audit table.

All endpoints require a Bearer access token. `/api/admin/catalog` additionally requires `ADMIN`.

| Method | Admin path | Behavior |
| --- | --- | --- |
| GET | `/categories`, `/brands`, `/services`, `/models` | Search, filters and pagination |
| POST | `/categories`, `/brands`, `/services`, `/models` | Create |
| PATCH | `/categories/:id`, `/brands/:id`, `/services/:id`, `/models/:id` | Update provided fields |
| DELETE | `/categories/:id` | Delete only when no services reference it |
| PATCH | `/services/:id/status` | Set `{ "is_active": true/false }` |
| PATCH | `/models/:id/status` | Soft-disable or reactivate; no model delete endpoint |

List queries: `search`, `status=all|active|inactive`, `page` (default 1), `limit` (default 10, maximum 100). Services also accept `category_id`. Responses use `{ data: { items, total, page, limit } }`.

Models accept `brand_id`, `ac_type`, `capacity_btu` (exact positive integer) and `inverter=true|false`; filters can be combined. Models require `model_name` (1–100 trimmed characters), an existing `brand_id`, `ac_type`, positive integer `capacity_btu` and boolean `inverter` on creation. Optional fields: `description`, `is_active`. Supported type codes: `WALL_MOUNTED`, `CEILING_CASSETTE`, `CEILING_SUSPENDED`, `FLOOR_STANDING`, `DUCTED`, `PORTABLE`, `WINDOW`. Existing nullable specifications remain readable; forms require complete valid specifications when saving.

Model names are unique within a brand (case-insensitive checks), including when moving a model to another brand. Deactivation only updates the model's `is_active` and `updated_at`; it does not delete the row or write to bookings, booking units, or snapshots. Mobile `GET /api/catalog/models` returns active models belonging to active brands. Historical booking displays should retrieve their stored references/snapshots directly rather than relying on this selection endpoint.

The mobile read endpoints are `GET /api/catalog/categories`, `/api/catalog/brands` and `/api/catalog/services`. They always return active records regardless of the requested status. Services also require an active parent category. This controls catalog visibility; booking creation must independently recheck eligibility when that module is implemented.

Supported fields follow the existing database: `name`, `description`, `is_active`; categories additionally support `image_url`; services support `category_id`, `base_price`, `estimated_duration` (minutes) and `maintenance_interval_days`. Optional intervals accept `null`. Brand logos, countries and AC types are not columns in `ac_brands` and are not invented by these screens.

Changes use transactions and maintain the existing timestamps. Normalized names are checked under a transaction advisory lock. Category deletion relies on the existing restrictive foreign key, returning `409 RESOURCE_IN_USE` when referenced.

Frontend routes: `/catalog/categories`, `/catalog/brands`, `/catalog/services`, `/catalog/models`, and each route's `/new` page. The persistent Admin sidebar contains all catalog links; selecting a link replaces the main content while retaining the complete navigation.

Validation/access tests: `npm test` (or `node --test --test-isolation=none` in restricted environments). Optional PostgreSQL integration test, using the configured local DB and rolling back all fixtures:

```powershell
$env:RUN_CATALOG_DB_TESTS = '1'
node --test --test-isolation=none tests/catalog.database.test.js
Remove-Item Env:RUN_CATALOG_DB_TESTS
```
