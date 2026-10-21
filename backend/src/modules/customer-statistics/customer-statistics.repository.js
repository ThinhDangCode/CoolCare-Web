import { withTransaction } from '../../config/database.js'

// SELECT-only fixture sources are injected by tests, never by an HTTP request.
export function buildCustomerStatisticsSql(sources = {}) {
  const source = {
    customers: 'SELECT id,user_id,created_at FROM customer_profiles',
    users: 'SELECT id,full_name,email,phone,avatar_url,status FROM users',
    addresses: "SELECT a.id,a.customer_id,a.city,to_jsonb(a)->>'district' AS district,a.ward,a.is_default FROM customer_addresses a",
    bookings: 'SELECT id,customer_id,created_at,status,cancelled_by_id FROM bookings',
    quotations: 'SELECT booking_id,status FROM quotations',
    units: 'SELECT id,booking_id FROM booking_units',
    unitServices: 'SELECT booking_unit_id,service_id FROM booking_unit_services',
    services: 'SELECT id,name,category_id FROM services',
    categories: 'SELECT id,name FROM service_categories',
    ...sources,
  }
  return `WITH
    source_customers AS (${source.customers}), source_users AS (${source.users}),
    source_addresses AS (${source.addresses}), source_bookings AS (${source.bookings}),
    source_quotations AS (${source.quotations}), source_units AS (${source.units}),
    source_unit_services AS (${source.unitServices}), source_services AS (${source.services}),
    source_categories AS (${source.categories}),
    bounds AS (
      SELECT $1::date::timestamp AT TIME ZONE INTERVAL '+07:00' AS start_at,
        ($2::date+1)::timestamp AT TIME ZONE INTERVAL '+07:00' AS end_at,
        ($1::date-($2::date-$1::date+1))::timestamp AT TIME ZONE INTERVAL '+07:00' AS previous_start_at,
        date_trunc('month',$2::date::timestamp) AT TIME ZONE INTERVAL '+07:00' AS month_start_at,
        date_trunc('year',$2::date::timestamp) AT TIME ZONE INTERVAL '+07:00' AS year_start_at
    ),
    customers AS (
      SELECT c.id,c.user_id,c.created_at,u.full_name,u.email,u.phone,u.avatar_url,u.status,
        EXISTS(SELECT 1 FROM source_bookings b WHERE b.customer_id=c.id) AS has_bookings
      FROM source_customers c JOIN source_users u ON u.id=c.user_id
    ),
    customer_summary AS (
      SELECT count(*)::text AS total,
        count(*) FILTER(WHERE created_at>=start_at AND created_at<end_at)::text AS new,
        count(*) FILTER(WHERE status='ACTIVE')::text AS active,
        count(*) FILTER(WHERE status='LOCKED')::text AS locked,
        count(*) FILTER(WHERE status='INACTIVE')::text AS inactive,
        count(*) FILTER(WHERE has_bookings)::text AS with_bookings,
        count(*) FILTER(WHERE NOT has_bookings)::text AS without_bookings,
        count(*) FILTER(WHERE created_at>=previous_start_at AND created_at<start_at)::text AS previous,
        count(*) FILTER(WHERE created_at>=month_start_at AND created_at<end_at)::text AS month,
        count(*) FILTER(WHERE created_at>=year_start_at AND created_at<end_at)::text AS year
      FROM customers CROSS JOIN bounds
    ),
    default_addresses AS (
      SELECT DISTINCT ON(customer_id) customer_id,NULLIF(btrim(city),'') AS city,
        NULLIF(btrim(district),'') AS district,NULLIF(btrim(ward),'') AS ward
      FROM source_addresses WHERE is_default ORDER BY customer_id,id
    ),
    customer_areas AS (
      SELECT c.id,c.created_at,
        CASE WHEN a.city IS NOT NULL AND (a.ward IS NOT NULL OR a.district IS NOT NULL) THEN a.city END AS city,
        CASE WHEN a.city IS NOT NULL AND (a.ward IS NOT NULL OR a.district IS NOT NULL) THEN a.district END AS district,
        CASE WHEN a.city IS NOT NULL AND (a.ward IS NOT NULL OR a.district IS NOT NULL) THEN a.ward END AS ward,
        a.city IS NULL OR (a.ward IS NULL AND a.district IS NULL) AS missing
      FROM customers c LEFT JOIN default_addresses a ON a.customer_id=c.id
    ),
    area_totals AS (
      SELECT jsonb_build_array(city,district,ward)::text AS key,
        CASE WHEN missing THEN 'Unknown area' ELSE concat_ws(', ',ward,district,city) END AS label,
        city,district,ward,missing,count(*)::text AS count,
        count(*) FILTER(WHERE created_at>=start_at AND created_at<end_at)::text AS new_count,
        count(*) FILTER(WHERE created_at>=previous_start_at AND created_at<start_at)::text AS previous_count
      FROM customer_areas CROSS JOIN bounds GROUP BY city,district,ward,missing
    ),
    booking_cohort AS (
      SELECT b.*,c.user_id,
        b.status='CANCELLED' AND b.cancelled_by_id=c.user_id AS customer_cancelled,
        b.status='QUOTATION_REJECTED' OR EXISTS(
          SELECT 1 FROM source_quotations q WHERE q.booking_id=b.id AND q.status='REJECTED') AS customer_rejected
      FROM source_bookings b JOIN customers c ON c.id=b.customer_id CROSS JOIN bounds
      WHERE b.created_at>=start_at AND b.created_at<end_at
    ),
    completed AS (SELECT * FROM booking_cohort WHERE status='COMPLETED'),
    customer_bookings AS (SELECT customer_id,count(*) AS count FROM completed GROUP BY customer_id),
    usage_lines AS (
      SELECT b.id AS booking_id,b.customer_id,us.service_id,s.name AS service_name,
        s.category_id,sc.name AS category_name
      FROM completed b JOIN source_units u ON u.booking_id=b.id
      JOIN source_unit_services us ON us.booking_unit_id=u.id
      LEFT JOIN source_services s ON s.id=us.service_id
      LEFT JOIN source_categories sc ON sc.id=s.category_id
    ),
    service_usage AS (
      SELECT COALESCE(service_id::text,'UNCLASSIFIED') AS id,
        COALESCE(service_name,'Unclassified service') AS name,count(*)::text AS count,
        count(DISTINCT customer_id)::text AS customers,count(DISTINCT booking_id)::text AS bookings
      FROM usage_lines GROUP BY service_id,service_name
    ),
    category_usage AS (
      SELECT COALESCE(category_id::text,'UNCLASSIFIED') AS id,
        COALESCE(category_name,'Unclassified category') AS name,count(*)::text AS count
      FROM usage_lines GROUP BY category_id,category_name
    ),
    buckets AS (
      SELECT generate_series(date_trunc($3::text,$1::date::timestamp),date_trunc($3::text,$2::date::timestamp),
        CASE WHEN $3::text='day' THEN interval '1 day' ELSE interval '1 month' END)::date AS bucket
    ),
    acquisition_trend AS (
      SELECT date_trunc($3::text,created_at AT TIME ZONE INTERVAL '+07:00')::date AS bucket,count(*)::text AS count
      FROM customers CROSS JOIN bounds WHERE created_at>=start_at AND created_at<end_at GROUP BY 1
    ),
    cancellation_trend AS (
      SELECT date_trunc($3::text,created_at AT TIME ZONE INTERVAL '+07:00')::date AS bucket,
        count(*)::text AS total,count(*) FILTER(WHERE customer_cancelled)::text AS cancelled,
        count(*) FILTER(WHERE customer_rejected)::text AS rejected
      FROM booking_cohort GROUP BY 1
    ),
    locked_matches AS (
      SELECT * FROM customers WHERE status='LOCKED' AND ($4::text='' OR
        strpos(lower(concat_ws(' ',id::text,full_name,email,phone)),lower($4::text))>0)
    ),
    locked_page AS (SELECT * FROM locked_matches ORDER BY created_at DESC,id LIMIT $5::int OFFSET $6::int)
    SELECT transaction_timestamp() AS "asOf",
      jsonb_build_object('totalCustomers',s.total,'newCustomers',s.new,'activeCustomers',s.active,
        'lockedCustomers',s.locked,'inactiveCustomers',s.inactive,
        'customersWithBookings',s.with_bookings,'customersWithoutBookings',s.without_bookings) AS summary,
      jsonb_build_object('currentCount',s.new,'previousCount',s.previous,'monthCount',s.month,'yearCount',s.year,
        'trend',(SELECT jsonb_agg(jsonb_build_object('date',to_char(b.bucket,'YYYY-MM-DD'),'count',COALESCE(t.count,'0'))
          ORDER BY b.bucket) FROM buckets b LEFT JOIN acquisition_trend t ON t.bucket=b.bucket)) AS acquisition,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('key',key,'label',label,'city',city,'district',district,'ward',ward,
        'count',count,'newCount',new_count,'previousNewCount',previous_count,'missing',missing)
        ORDER BY count::bigint DESC,key) FROM area_totals),'[]'::jsonb) AS areas,
      jsonb_build_object('totalBookings',(SELECT count(*)::text FROM completed),
        'distinctCustomers',(SELECT count(*)::text FROM customer_bookings),
        'totalUses',(SELECT count(*)::text FROM usage_lines),
        'repeatCustomers',(SELECT count(*)::text FROM customer_bookings WHERE count>=2),
        'services',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY count::bigint DESC,id) FROM service_usage t),'[]'::jsonb),
        'categories',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY count::bigint DESC,id) FROM category_usage t),'[]'::jsonb)) AS usage,
      jsonb_build_object('totalBookings',(SELECT count(*)::text FROM booking_cohort),
        'cancelledBookings',(SELECT count(*) FILTER(WHERE customer_cancelled)::text FROM booking_cohort),
        'rejectedBookings',(SELECT count(*) FILTER(WHERE customer_rejected)::text FROM booking_cohort),
        'affectedBookings',(SELECT count(*) FILTER(WHERE customer_cancelled OR customer_rejected)::text FROM booking_cohort),
        'trend',(SELECT jsonb_agg(jsonb_build_object('date',to_char(b.bucket,'YYYY-MM-DD'),
          'totalBookings',COALESCE(t.total,'0'),'cancelledBookings',COALESCE(t.cancelled,'0'),
          'rejectedBookings',COALESCE(t.rejected,'0')) ORDER BY b.bucket)
          FROM buckets b LEFT JOIN cancellation_trend t ON t.bucket=b.bucket)) AS cancellations,
      jsonb_build_object('total',(SELECT count(*)::text FROM locked_matches),
        'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',full_name,'email',email,'phone',phone,
          'avatarUrl',avatar_url,'status',status,'registeredAt',created_at) ORDER BY created_at DESC,id)
          FROM locked_page),'[]'::jsonb)) AS locked
    FROM customer_summary s`
}

export const CUSTOMER_STATISTICS_SQL = buildCustomerStatisticsSql()

export class CustomerStatisticsRepository {
  constructor(transaction = withTransaction) { this.transaction = transaction }

  async readCustomerStatistics(query) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const { rows } = await client.query(CUSTOMER_STATISTICS_SQL,
        [query.from, query.to, query.granularity, query.search, query.limit, (query.page - 1) * query.limit])
      return { ...rows[0], asOf: rows[0].asOf.toISOString() }
    })
  }
}
