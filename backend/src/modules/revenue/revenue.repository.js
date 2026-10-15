import { withTransaction } from '../../config/database.js'
import { requireValidBody } from '../../utils.js'
import { revenueAreaSql, SERVICE_BUCKETS, UNKNOWN_AREA } from './revenue.constants.js'

// Every source is internal, static SQL. Tests may substitute VALUES-only sources,
// allowing the real allocation query to be verified without changing any table.
export function buildRevenueAggregationSql({
  payments = 'SELECT p.*, b.city FROM payments p JOIN bookings b ON b.id=p.booking_id',
  lines = `SELECT q.booking_id, qi.id AS item_id, qi.total_price, qi.item_type,
    COALESCE(qi.service_id, CASE WHEN bu.booking_id=q.booking_id THEN bus.service_id END)::text AS service_id,
    s.name AS service_name
    FROM quotations q JOIN quotation_items qi ON qi.quotation_id=q.id
    LEFT JOIN booking_unit_services bus ON bus.id=qi.booking_unit_service_id
    LEFT JOIN booking_units bu ON bu.id=bus.booking_unit_id
    LEFT JOIN services s ON s.id=COALESCE(qi.service_id, CASE WHEN bu.booking_id=q.booking_id THEN bus.service_id END)
    WHERE q.status='ACCEPTED' AND qi.item_type IN ('SERVICE','LABOR')`,
} = {}) {
  return `WITH payment_source AS (${payments}), line_source AS (${lines}),
    eligible AS (
      SELECT p.id, p.booking_id, p.commission_amount, p.commission_base_amount,
        ${revenueAreaSql('p.city')} AS area_id,
        CASE WHEN p.settled_at >= ($1::date::timestamp AT TIME ZONE INTERVAL '+07:00') THEN 'CURRENT' ELSE 'PREVIOUS' END AS period,
        p.settled_at AT TIME ZONE INTERVAL '+07:00' AS local_settled
      FROM payment_source p WHERE p.payment_status='SUCCESS' AND p.settled_at IS NOT NULL
        AND ((p.settled_at >= ($1::date::timestamp AT TIME ZONE INTERVAL '+07:00')
              AND p.settled_at < (($2::date+1)::timestamp AT TIME ZONE INTERVAL '+07:00'))
          OR (p.settled_at >= ($3::date::timestamp AT TIME ZONE INTERVAL '+07:00')
              AND p.settled_at < (($4::date+1)::timestamp AT TIME ZONE INTERVAL '+07:00')))
        AND ($6='ALL' OR ${revenueAreaSql('p.city')}=$6)
    ), line_groups AS (
      SELECT p.id AS payment_id, COALESCE(l.service_id,'UNCLASSIFIED') AS service_id,
        COALESCE(min(l.service_name),'Unclassified labor / service') AS service_name,
        SUM(l.total_price) AS basis, count(*) AS line_count,
        bool_or(l.total_price IS NULL OR l.total_price < 0) AS invalid_line
      FROM eligible p JOIN line_source l ON l.booking_id=p.booking_id
      GROUP BY p.id, COALESCE(l.service_id,'UNCLASSIFIED')
    ), basis AS (
      SELECT payment_id, SUM(basis) AS line_basis, bool_or(invalid_line) AS invalid_line
      FROM line_groups GROUP BY payment_id
    ), classified AS (
      SELECT p.*, COALESCE(p.commission_base_amount > 0 AND b.line_basis=p.commission_base_amount
        AND NOT b.invalid_line, false) AS allocatable
      FROM eligible p LEFT JOIN basis b ON b.payment_id=p.id
    ), shares AS (
      SELECT p.*, g.service_id, g.service_name,
        div(round(p.commission_amount*100)*round(g.basis*100),round(p.commission_base_amount*100)) AS floor_units,
        mod(round(p.commission_amount*100)*round(g.basis*100),round(p.commission_base_amount*100)) AS remainder
      FROM classified p JOIN line_groups g ON g.payment_id=p.id WHERE p.allocatable
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY id ORDER BY remainder DESC NULLS LAST,service_id COLLATE "C") AS remainder_rank,
        round(commission_amount*100)-SUM(floor_units) OVER (PARTITION BY id) AS remaining_units
      FROM shares
    ), allocations AS (
      SELECT id, period, local_settled, area_id, service_id,service_name, commission_amount,
        round((floor_units + CASE WHEN remainder_rank <= remaining_units THEN 1 ELSE 0 END)/100,2) AS amount,
        false AS unallocated, false AS ambiguous
      FROM ranked
      UNION ALL
      SELECT id,period,local_settled,area_id,'UNALLOCATED','Unallocated commission',commission_amount,
        commission_amount,true,false FROM classified WHERE NOT allocatable
    ), selected AS (
      SELECT * FROM allocations WHERE $5='ALL' OR service_id=$5
      UNION ALL
      -- An invalid basis may belong to a selected service. Its money is known at
      -- payment level, but its selected-service share is unknown, never zero.
      SELECT id,period,local_settled,area_id,$5,$8,commission_amount,NULL::numeric,true,true
      FROM allocations WHERE unallocated AND $5 NOT IN ('ALL','UNALLOCATED')
    ), bucketed AS (
      SELECT *, CASE WHEN $7='MONTH' THEN extract(day FROM local_settled)::int
        ELSE ((extract(year FROM local_settled)::int-extract(year FROM CASE WHEN period='CURRENT' THEN $1::date ELSE $3::date END)::int)*12
          +extract(month FROM local_settled)::int-extract(month FROM CASE WHEN period='CURRENT' THEN $1::date ELSE $3::date END)::int+1) END AS bucket
      FROM selected
    ), aggregates AS (
      SELECT 'SUMMARY' AS kind,period,NULL::text AS key,NULL::text AS label,
        SUM(amount) AS total,COALESCE(SUM(amount),0::numeric) AS known,
        count(DISTINCT id) AS payment_count,
        count(DISTINCT id) FILTER (WHERE commission_amount IS NULL) AS missing_count,
        count(DISTINCT id) FILTER (WHERE amount IS NULL) AS unknown_count,
        count(DISTINCT id) FILTER (WHERE unallocated) AS unallocated_count,
        count(DISTINCT id) FILTER (WHERE service_id='UNCLASSIFIED') AS unclassified_count
      FROM bucketed GROUP BY period
      UNION ALL
      SELECT 'TREND',period,bucket::text,NULL,SUM(amount),COALESCE(SUM(amount),0::numeric),
        count(DISTINCT id),count(DISTINCT id) FILTER (WHERE commission_amount IS NULL),
        count(DISTINCT id) FILTER (WHERE amount IS NULL),0,0
      FROM bucketed GROUP BY period,bucket
      UNION ALL
      SELECT 'SERVICE',period,service_id,min(service_name),SUM(amount),COALESCE(SUM(amount),0::numeric),
        count(DISTINCT id),count(DISTINCT id) FILTER (WHERE commission_amount IS NULL),
        count(DISTINCT id) FILTER (WHERE amount IS NULL),0,0
      FROM bucketed WHERE period='CURRENT' GROUP BY period,service_id
      UNION ALL
      SELECT 'AREA',period,area_id,CASE WHEN area_id='UNKNOWN_AREA' THEN 'Unknown area' ELSE area_id END,
        SUM(amount),COALESCE(SUM(amount),0::numeric),count(DISTINCT id),
        count(DISTINCT id) FILTER (WHERE commission_amount IS NULL),
        count(DISTINCT id) FILTER (WHERE amount IS NULL),0,0
      FROM bucketed WHERE period='CURRENT' GROUP BY period,area_id
    ) SELECT kind,period,key,label,CASE WHEN unknown_count>0 THEN NULL ELSE total::text END AS amount,
      known::text AS "knownAmount",payment_count::text AS "paymentCount",
      missing_count::text AS "missingCommissionCount",unknown_count::text AS "unknownCount",
      unallocated_count::text AS "unallocatedCount",unclassified_count::text AS "unclassifiedCount"
      FROM aggregates ORDER BY kind,period,key`
}

export const REVENUE_AGGREGATION_SQL = buildRevenueAggregationSql()

export class RevenueRepository {
  constructor({ transaction = withTransaction } = {}) {
    this.transaction = transaction
  }

  async readRevenueReport(request) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const services = (
        await client.query('SELECT id::text AS id,name FROM services ORDER BY lower(name),id')
      ).rows
      const areas = (
        await client.query(`SELECT DISTINCT ${revenueAreaSql('b.city')} AS id
        FROM payments p JOIN bookings b ON b.id=p.booking_id
        WHERE p.payment_status='SUCCESS' AND p.settled_at IS NOT NULL ORDER BY id`)
      ).rows.map(({ id }) => ({ id, name: id === UNKNOWN_AREA.id ? UNKNOWN_AREA.name : id }))
      const service = request.filters.service
      const area = request.filters.area
      requireValidBody({
        service:
          service === 'ALL' ||
          Object.hasOwn(SERVICE_BUCKETS, service) ||
          services.some((option) => option.id === service)
            ? null
            : 'Không tìm thấy dịch vụ đã chọn.',
        area:
          area === 'ALL' || areas.some((option) => option.id === area)
            ? null
            : 'Không tìm thấy khu vực đã chọn.',
      })
      const { period } = request
      const rows = (
        await client.query(REVENUE_AGGREGATION_SQL, [
          period.from,
          period.to,
          period.previousFrom,
          period.previousTo,
          service,
          area,
          period.type,
          services.find((option) => option.id === service)?.name ??
            SERVICE_BUCKETS[service] ??
            service,
        ])
      ).rows
      // Special buckets remain selectable across periods, including an empty one.
      const buckets = Object.entries(SERVICE_BUCKETS).map(([id, name]) => ({ id, name }))
      return { rows, options: { services: [...services, ...buckets], areas } }
    })
  }
}
