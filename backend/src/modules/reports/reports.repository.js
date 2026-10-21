import { withTransaction } from '../../config/database.js'

// Sources can be replaced with SELECT-only CTE fixtures by database tests. Never accept SQL from HTTP.
export function buildReportsAggregationSql(sources = {}) {
  const source = {
    bookings: 'SELECT id, created_at, status FROM bookings',
    payments: 'SELECT payment_status::text, settled_at, commission_amount FROM payments',
    customers: 'SELECT id FROM customer_profiles',
    technicians: 'SELECT id FROM technician_profiles',
    units: 'SELECT id, booking_id FROM booking_units',
    unitServices: 'SELECT booking_unit_id, service_id FROM booking_unit_services',
    services: 'SELECT id, name FROM services',
    ...sources,
  }
  return `WITH
    source_bookings AS (${source.bookings}),
    source_payments AS (${source.payments}),
    source_customers AS (${source.customers}),
    source_technicians AS (${source.technicians}),
    source_units AS (${source.units}),
    source_unit_services AS (${source.unitServices}),
    source_services AS (${source.services}),
    bounds AS (
      SELECT $1::date::timestamp AT TIME ZONE INTERVAL '+07:00' AS start_at,
        ($2::date + 1)::timestamp AT TIME ZONE INTERVAL '+07:00' AS end_at
    ),
    booking_cohort AS (
      SELECT b.* FROM source_bookings b CROSS JOIN bounds
      WHERE b.created_at >= bounds.start_at AND b.created_at < bounds.end_at
    ),
    eligible_payments AS (
      SELECT p.* FROM source_payments p CROSS JOIN bounds
      WHERE p.payment_status='SUCCESS' AND p.settled_at IS NOT NULL
        AND p.settled_at >= bounds.start_at AND p.settled_at < bounds.end_at
    ),
    payment_summary AS (
      SELECT count(*)::text AS count,
        count(*) FILTER (WHERE commission_amount IS NULL)::text AS missing,
        COALESCE(sum(commission_amount),0)::text AS known,
        CASE WHEN count(*) FILTER (WHERE commission_amount IS NULL)>0 THEN NULL
          ELSE COALESCE(sum(commission_amount),0)::text END AS amount
      FROM eligible_payments
    ),
    booking_status AS (
      SELECT CASE WHEN status='COMPLETED' THEN 'completed'
        WHEN status='CANCELLED' THEN 'cancelled' ELSE 'processing' END AS key,
        count(*)::text AS count FROM booking_cohort GROUP BY 1
    ),
    booking_trend AS (
      SELECT date_trunc($3::text,created_at AT TIME ZONE INTERVAL '+07:00')::date AS bucket,
        count(*)::text AS count FROM booking_cohort GROUP BY 1
    ),
    payment_trend AS (
      SELECT date_trunc($3::text,settled_at AT TIME ZONE INTERVAL '+07:00')::date AS bucket,
        count(*)::text AS count,
        count(*) FILTER (WHERE commission_amount IS NULL)::text AS missing,
        COALESCE(sum(commission_amount),0)::text AS known,
        CASE WHEN count(*) FILTER (WHERE commission_amount IS NULL)>0 THEN NULL
          ELSE COALESCE(sum(commission_amount),0)::text END AS amount
      FROM eligible_payments GROUP BY 1
    ),
    buckets AS (
      SELECT generate_series(date_trunc($3::text,$1::date::timestamp),
        date_trunc($3::text,$2::date::timestamp),
        CASE WHEN $3::text='day' THEN interval '1 day' ELSE interval '1 month' END)::date AS bucket
    ),
    service_usage AS (
      SELECT COALESCE(us.service_id::text,'UNCLASSIFIED') AS id,
        COALESCE(s.name,'Unclassified service') AS name,count(*) AS count
      FROM booking_cohort b
      JOIN source_units u ON u.booking_id=b.id
      JOIN source_unit_services us ON us.booking_unit_id=u.id
      LEFT JOIN source_services s ON s.id=us.service_id
      GROUP BY 1,2
    )
    SELECT transaction_timestamp() AS "asOf",
      jsonb_build_object(
        'bookings',(SELECT count(*)::text FROM booking_cohort),
        'customers',(SELECT count(*)::text FROM source_customers),
        'technicians',(SELECT count(*)::text FROM source_technicians),
        'commissionAmount',p.amount,'knownCommissionAmount',p.known,
        'settledPayments',p.count,'missingCommissionPayments',p.missing
      ) AS summary,
      (SELECT jsonb_agg(jsonb_build_object('key',k.key,'count',COALESCE(s.count,'0')) ORDER BY k.ordinal)
        FROM (VALUES ('completed',1),('processing',2),('cancelled',3)) k(key,ordinal)
        LEFT JOIN booking_status s ON s.key=k.key) AS "bookingOverview",
      (SELECT jsonb_agg(jsonb_build_object(
        'date',to_char(b.bucket,'YYYY-MM-DD'),'bookings',COALESCE(t.count,'0'),
        'commissionAmount',CASE WHEN r.bucket IS NULL THEN '0' ELSE r.amount END,
        'knownCommissionAmount',COALESCE(r.known,'0'),
        'settledPayments',COALESCE(r.count,'0'),'missingCommissionPayments',COALESCE(r.missing,'0')
      ) ORDER BY b.bucket)
        FROM buckets b LEFT JOIN booking_trend t ON t.bucket=b.bucket
        LEFT JOIN payment_trend r ON r.bucket=b.bucket) AS trend,
      jsonb_build_object('totalUses',COALESCE((SELECT sum(count)::text FROM service_usage),'0'),
        'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'count',count::text)
          ORDER BY count DESC,id) FROM service_usage),'[]'::jsonb)) AS services
    FROM payment_summary p`
}

export const REPORTS_AGGREGATION_SQL = buildReportsAggregationSql()

export class ReportsRepository {
  constructor(transaction = withTransaction) {
    this.transaction = transaction
  }

  async readReports(period) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const result = await client.query(REPORTS_AGGREGATION_SQL, [period.from, period.to, period.granularity])
      const row = result.rows[0]
      return { ...row, asOf: row.asOf.toISOString() }
    })
  }
}
