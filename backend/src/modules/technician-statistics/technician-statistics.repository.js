import { withTransaction } from '../../config/database.js'

// Only tests may replace these sources with SELECT-only fixtures; no HTTP input becomes SQL.
export function buildTechnicianStatisticsSql(sources = {}) {
  const source = {
    technicians: 'SELECT id,user_id,is_active,verification_status,created_at FROM technician_profiles',
    users: 'SELECT id,full_name,email,phone,avatar_url,status FROM users',
    areas: 'SELECT technician_id,city,ward FROM technician_areas',
    assignments: 'SELECT id,booking_id,technician_id,status,requested_at,responded_at FROM booking_technicians',
    bookings: 'SELECT id,status,cancelled_by_id FROM bookings',
    history: 'SELECT booking_id,status,changed_by_id,created_at FROM booking_status_history',
    payments: 'SELECT id,booking_id,technician_id,payment_status,settled_at,technician_earning FROM payments',
    reviews: 'SELECT id,technician_id,status,rating,created_at FROM reviews',
    complaints: 'SELECT id,technician_id,status,created_at FROM complaints',
    penalties: 'SELECT id,technician_id,applied_at FROM technician_penalties',
    ...sources,
  }
  return `WITH
    source_technicians AS (${source.technicians}), source_users AS (${source.users}),
    source_areas AS (${source.areas}), source_assignments AS (${source.assignments}),
    source_bookings AS (${source.bookings}), source_history AS (${source.history}),
    source_payments AS (${source.payments}), source_reviews AS (${source.reviews}),
    source_complaints AS (${source.complaints}), source_penalties AS (${source.penalties}),
    bounds AS (
      SELECT $1::date::timestamp AT TIME ZONE INTERVAL '+07:00' AS start_at,
        ($2::date+1)::timestamp AT TIME ZONE INTERVAL '+07:00' AS end_at
    ),
    technicians AS (
      SELECT t.*,u.full_name,u.email,u.phone,u.avatar_url,u.status AS account_status,
        CASE WHEN u.status='LOCKED' THEN 'LOCKED'
          WHEN u.status='ACTIVE' AND t.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status
      FROM source_technicians t JOIN source_users u ON u.id=t.user_id
    ),
    summary AS (
      SELECT count(*)::text AS total,
        count(*) FILTER(WHERE status='ACTIVE')::text AS active,
        count(*) FILTER(WHERE status='INACTIVE')::text AS inactive,
        count(*) FILTER(WHERE status='LOCKED')::text AS locked,
        count(*) FILTER(WHERE verification_status=1)::text AS verified,
        count(*) FILTER(WHERE verification_status=0)::text AS pending,
        count(*) FILTER(WHERE verification_status=2)::text AS rejected
      FROM technicians
    ),
    buckets AS (
      SELECT generate_series(date_trunc($3::text,$1::date::timestamp),date_trunc($3::text,$2::date::timestamp),
        CASE WHEN $3::text='day' THEN interval '1 day' ELSE interval '1 month' END)::date AS bucket
    ),
    eligible_payments AS (
      SELECT p.*,t.full_name FROM source_payments p JOIN technicians t ON t.id=p.technician_id CROSS JOIN bounds
      WHERE p.payment_status='SUCCESS' AND p.settled_at>=start_at AND p.settled_at<end_at
    ),
    income_summary AS (
      SELECT COALESCE(sum(technician_earning),0)::text AS known,
        count(*) FILTER(WHERE technician_earning IS NULL)::text AS missing,
        count(*)::text AS payments,count(DISTINCT technician_id)::text AS technicians,
        count(DISTINCT p.booking_id) FILTER(WHERE b.status='COMPLETED')::text AS completed
      FROM eligible_payments p LEFT JOIN source_bookings b ON b.id=p.booking_id
    ),
    income_technicians AS (
      SELECT technician_id::text AS id,full_name AS name,COALESCE(sum(technician_earning),0)::text AS "knownAmount",
        count(*) FILTER(WHERE technician_earning IS NULL)::text AS "missingPayments"
      FROM eligible_payments GROUP BY technician_id,full_name
    ),
    income_trend AS (
      SELECT date_trunc($3::text,settled_at AT TIME ZONE INTERVAL '+07:00')::date AS bucket,
        COALESCE(sum(technician_earning),0)::text AS known,
        count(*) FILTER(WHERE technician_earning IS NULL)::text AS missing,count(*)::text AS payments
      FROM eligible_payments GROUP BY 1
    ),
    coverage AS (
      SELECT DISTINCT a.technician_id,btrim(a.city) AS city,btrim(a.ward) AS ward
      FROM source_areas a JOIN technicians t ON t.id=a.technician_id
      WHERE NULLIF(btrim(a.city),'') IS NOT NULL AND NULLIF(btrim(a.ward),'') IS NOT NULL
    ),
    area_counts AS (
      SELECT jsonb_build_array(city,ward)::text AS key,concat_ws(', ',ward,city) AS label,
        city,ward,count(*)::text AS count FROM coverage GROUP BY city,ward
    ),
    latest_assignments AS (
      SELECT DISTINCT ON(technician_id,booking_id) * FROM source_assignments
      ORDER BY technician_id,booking_id,requested_at DESC,id DESC
    ),
    request_cohort AS (
      SELECT a.*,t.user_id,
        a.status IN ('ACCEPTED','COMPLETED') OR EXISTS(
          SELECT 1 FROM source_history h WHERE h.booking_id=a.booking_id AND h.status='ACCEPTED'
            AND h.changed_by_id=t.user_id AND h.created_at>=a.requested_at) AS accepted,
        a.status='COMPLETED' AND b.status='COMPLETED' AS completed,
        a.status='CANCELLED' AND b.status='CANCELLED' AND b.cancelled_by_id=t.user_id AS technician_cancelled,
        a.status='CANCELLED' AND NOT COALESCE(b.status='CANCELLED' AND b.cancelled_by_id=t.user_id,false) AS other_cancelled
      FROM latest_assignments a JOIN technicians t ON t.id=a.technician_id
      JOIN source_bookings b ON b.id=a.booking_id CROSS JOIN bounds
      WHERE a.requested_at>=start_at AND a.requested_at<end_at
        AND a.status IN ('SELECTED','ACCEPTED','DECLINED','EXPIRED','COMPLETED','CANCELLED')
    ),
    activity_summary AS (
      SELECT count(*)::text AS total,count(*) FILTER(WHERE accepted)::text AS accepted,
        count(*) FILTER(WHERE completed)::text AS completed,
        count(*) FILTER(WHERE status=3)::text AS declined,
        count(*) FILTER(WHERE technician_cancelled)::text AS technician_cancelled,
        count(*) FILTER(WHERE other_cancelled)::text AS other_cancelled,
        count(*) FILTER(WHERE status=1)::text AS pending,
        count(*) FILTER(WHERE status=5)::text AS expired FROM request_cohort
    ),
    activity_trend AS (
      SELECT date_trunc($3::text,requested_at AT TIME ZONE INTERVAL '+07:00')::date AS bucket,
        count(*)::text AS total,count(*) FILTER(WHERE accepted)::text AS accepted,
        count(*) FILTER(WHERE completed)::text AS completed,
        count(*) FILTER(WHERE status=3)::text AS declined,
        count(*) FILTER(WHERE technician_cancelled)::text AS technician_cancelled
      FROM request_cohort GROUP BY 1
    ),
    eligible_reviews AS (
      SELECT r.* FROM source_reviews r JOIN technicians t ON t.id=r.technician_id CROSS JOIN bounds
      WHERE r.status='PUBLISHED' AND r.created_at>=start_at AND r.created_at<end_at
    ),
    review_summary AS (SELECT count(*)::text AS count,COALESCE(sum(rating),0)::text AS sum FROM eligible_reviews),
    review_trend AS (
      SELECT date_trunc($3::text,created_at AT TIME ZONE INTERVAL '+07:00')::date AS bucket,
        count(*)::text AS count,COALESCE(sum(rating),0)::text AS sum FROM eligible_reviews GROUP BY 1
    ),
    eligible_complaints AS (
      SELECT c.* FROM source_complaints c JOIN technicians t ON t.id=c.technician_id CROSS JOIN bounds
      WHERE c.created_at>=start_at AND c.created_at<end_at
    ),
    eligible_penalties AS (
      SELECT p.* FROM source_penalties p JOIN technicians t ON t.id=p.technician_id CROSS JOIN bounds
      WHERE p.applied_at>=start_at AND p.applied_at<end_at
    ),
    complaint_summary AS (
      SELECT count(*)::text AS total,count(*) FILTER(WHERE status IN (0,1))::text AS open,
        count(*) FILTER(WHERE status=2)::text AS resolved,
        count(*) FILTER(WHERE status=3)::text AS rejected,
        count(*) FILTER(WHERE status=4)::text AS closed FROM eligible_complaints
    ),
    complaint_trend AS (
      SELECT date_trunc($3::text,created_at AT TIME ZONE INTERVAL '+07:00')::date AS bucket,
        count(*)::text AS count,count(*) FILTER(WHERE status=2)::text AS resolved
      FROM eligible_complaints GROUP BY 1
    ),
    penalty_trend AS (
      SELECT date_trunc($3::text,applied_at AT TIME ZONE INTERVAL '+07:00')::date AS bucket,
        count(*)::text AS count FROM eligible_penalties GROUP BY 1
    ),
    locked_matches AS (
      SELECT * FROM technicians WHERE status='LOCKED' AND ($4::text='' OR
        strpos(lower(concat_ws(' ',id::text,full_name,email,phone)),lower($4::text))>0)
    ),
    locked_page AS (SELECT * FROM locked_matches ORDER BY created_at DESC,id LIMIT $5::int OFFSET $6::int)
    SELECT transaction_timestamp() AS "asOf",
      jsonb_build_object('totalTechnicians',s.total,'activeTechnicians',s.active,'inactiveTechnicians',s.inactive,
        'verifiedTechnicians',s.verified,'lockedTechnicians',s.locked,'pendingVerification',s.pending,
        'rejectedVerification',s.rejected) AS summary,
      jsonb_build_object('knownAmount',i.known,'missingPayments',i.missing,'settledPayments',i.payments,
        'earningTechnicians',i.technicians,'completedJobs',i.completed,
        'technicians',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM income_technicians t),'[]'::jsonb),
        'trend',(SELECT jsonb_agg(jsonb_build_object('date',to_char(b.bucket,'YYYY-MM-DD'),
          'knownAmount',COALESCE(t.known,'0'),'missingPayments',COALESCE(t.missing,'0'),
          'settledPayments',COALESCE(t.payments,'0')) ORDER BY b.bucket)
          FROM buckets b LEFT JOIN income_trend t ON t.bucket=b.bucket)) AS income,
      jsonb_build_object('coveredTechnicians',(SELECT count(DISTINCT technician_id)::text FROM coverage),
        'items',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY count::bigint DESC,key) FROM area_counts a),'[]'::jsonb)) AS areas,
      jsonb_build_object('totalRequests',a.total,'acceptedRequests',a.accepted,'completedRequests',a.completed,
        'declinedRequests',a.declined,'technicianCancelledRequests',a.technician_cancelled,
        'otherCancelledRequests',a.other_cancelled,'pendingRequests',a.pending,'expiredRequests',a.expired,
        'reviewCount',r.count,'ratingSum',r.sum,
        'trend',(SELECT jsonb_agg(jsonb_build_object('date',to_char(b.bucket,'YYYY-MM-DD'),
          'totalRequests',COALESCE(t.total,'0'),'acceptedRequests',COALESCE(t.accepted,'0'),
          'completedRequests',COALESCE(t.completed,'0'),'declinedRequests',COALESCE(t.declined,'0'),
          'technicianCancelledRequests',COALESCE(t.technician_cancelled,'0'),
          'reviewCount',COALESCE(v.count,'0'),'ratingSum',COALESCE(v.sum,'0')) ORDER BY b.bucket)
          FROM buckets b LEFT JOIN activity_trend t ON t.bucket=b.bucket LEFT JOIN review_trend v ON v.bucket=b.bucket)) AS activity,
      jsonb_build_object('complaints',c.total,'penalties',(SELECT count(*)::text FROM eligible_penalties),
        'openComplaints',c.open,'resolvedComplaints',c.resolved,'rejectedComplaints',c.rejected,'closedComplaints',c.closed,
        'affectedTechnicians',(SELECT count(*)::text FROM (SELECT technician_id FROM eligible_complaints
          UNION SELECT technician_id FROM eligible_penalties) t),
        'trend',(SELECT jsonb_agg(jsonb_build_object('date',to_char(b.bucket,'YYYY-MM-DD'),
          'complaints',COALESCE(q.count,'0'),'penalties',COALESCE(p.count,'0'),
          'resolvedComplaints',COALESCE(q.resolved,'0')) ORDER BY b.bucket)
          FROM buckets b LEFT JOIN complaint_trend q ON q.bucket=b.bucket LEFT JOIN penalty_trend p ON p.bucket=b.bucket)) AS issues,
      jsonb_build_object('total',(SELECT count(*)::text FROM locked_matches),
        'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',full_name,'email',email,'phone',phone,
          'avatarUrl',avatar_url,'verificationStatus',verification_status,'isActive',is_active,'registeredAt',created_at)
          ORDER BY created_at DESC,id) FROM locked_page),'[]'::jsonb)) AS locked
    FROM summary s CROSS JOIN income_summary i CROSS JOIN activity_summary a
      CROSS JOIN review_summary r CROSS JOIN complaint_summary c`
}

export const TECHNICIAN_STATISTICS_SQL = buildTechnicianStatisticsSql()

export class TechnicianStatisticsRepository {
  constructor(transaction = withTransaction) { this.transaction = transaction }

  async readTechnicianStatistics(query) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const { rows } = await client.query(TECHNICIAN_STATISTICS_SQL,
        [query.from, query.to, query.granularity, query.search, query.limit, (query.page - 1) * query.limit])
      return { ...rows[0], asOf: rows[0].asOf.toISOString() }
    })
  }
}
