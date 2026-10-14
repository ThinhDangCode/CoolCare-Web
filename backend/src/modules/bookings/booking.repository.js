import { pool } from '../../config/database.js'
import { AppError } from '../../utils.js'


const notFound = () => new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found.')
const paidColumn = `(SELECT COALESCE(sum(p.amount),0) FROM payments p WHERE p.booking_id=b.id AND p.payment_status='SUCCESS') AS paid_amount`
const techniciansColumn = `(SELECT COALESCE(json_agg(json_build_object('id',t.id,'full_name',u.full_name,'avatar_url',u.avatar_url,'rating_average',t.rating_average,'total_reviews',t.total_reviews,'status',bt.status) ORDER BY bt.requested_at DESC),'[]'::json)
  FROM booking_technicians bt JOIN technician_profiles t ON t.id=bt.technician_id JOIN users u ON u.id=t.user_id
  WHERE bt.booking_id=b.id AND bt.status IN ('SELECTED','ACCEPTED','COMPLETED')) AS technicians`
const servicesColumn = `(SELECT COALESCE(json_agg(json_build_object('id',s.id,'name',s.name,'unit_number',bu.unit_number,'unit_price',bus.unit_price) ORDER BY bu.unit_number,s.name),'[]'::json)
  FROM booking_units bu JOIN booking_unit_services bus ON bus.booking_unit_id=bu.id JOIN services s ON s.id=bus.service_id WHERE bu.booking_id=b.id) AS services`
export class BookingRepository {
  constructor({ db = pool } = {}) {
    this.db = db
  }
  async options() {
    return (await this.db.query('SELECT id,name FROM services ORDER BY name')).rows
  }
  async list(query) {
    const values = [], clauses = []
    const add = (sql, value) => { values.push(value); clauses.push(sql.replaceAll('?', `$${values.length}`)) }
    if (query.search) add(`(b.booking_code ILIKE ? OR b.recipient_name ILIKE ? OR b.recipient_phone ILIKE ? OR u.full_name ILIKE ? OR EXISTS (
      SELECT 1 FROM booking_units bu JOIN booking_unit_services bus ON bus.booking_unit_id=bu.id JOIN services s ON s.id=bus.service_id WHERE bu.booking_id=b.id AND s.name ILIKE ?))`, `%${query.search.replace(/[\\%_]/g, '\\$&')}%`)
    if (query.status !== 'ALL') add('b.status=?', query.status)
    if (query.service) add('EXISTS (SELECT 1 FROM booking_units bu JOIN booking_unit_services bus ON bus.booking_unit_id=bu.id WHERE bu.booking_id=b.id AND bus.service_id=?)', query.service)
    if (query.month) add("to_char(b.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')=?", query.month)
    const from = `FROM bookings b JOIN customer_profiles c ON c.id=b.customer_id JOIN users u ON u.id=c.user_id ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}`
    const [count, rows] = await Promise.all([
      this.db.query(`SELECT count(*)::int AS total ${from}`, values),
      this.db.query(`SELECT b.id,b.booking_code,b.recipient_name,b.scheduled_at,b.total_amount,b.status,u.full_name AS customer_name,${paidColumn},${techniciansColumn},${servicesColumn}
        ${from} ORDER BY b.created_at DESC,b.id LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values,query.limit,(query.page-1)*query.limit]),
    ])
    return { items: rows.rows, total: count.rows[0].total }
  }
  async detail(id) {
    const found = await this.db.query(`SELECT b.*,u.full_name AS customer_name,u.email AS customer_email,actor.full_name AS cancelled_by,${paidColumn},${techniciansColumn},${servicesColumn}
      FROM bookings b JOIN customer_profiles c ON c.id=b.customer_id JOIN users u ON u.id=c.user_id LEFT JOIN users actor ON actor.id=b.cancelled_by_id WHERE b.id=$1`, [id])
    if (!found.rows.length) throw notFound()
    const booking = found.rows[0]
    const [units,history] = await Promise.all([
      this.db.query(`SELECT bu.id,bu.unit_number,bu.description,bu.diagnosis,bu.service_notes,ab.name AS brand,am.model_name,
        (SELECT COALESCE(json_agg(json_build_object('name',s.name,'description',s.description,'unit_price',bus.unit_price,'estimated_duration',s.estimated_duration) ORDER BY s.name),'[]'::json)
        FROM booking_unit_services bus JOIN services s ON s.id=bus.service_id WHERE bus.booking_unit_id=bu.id) AS services
        FROM booking_units bu LEFT JOIN ac_brands ab ON ab.id=bu.ac_brand_id LEFT JOIN ac_models am ON am.id=bu.ac_model_id WHERE bu.booking_id=$1 ORDER BY bu.unit_number`, [id]),
      this.db.query(`SELECT h.id,h.status,h.note,h.created_at,u.full_name AS changed_by FROM booking_status_history h LEFT JOIN users u ON u.id=h.changed_by_id WHERE h.booking_id=$1 ORDER BY h.created_at,h.id`, [id]),
    ])
    return { ...booking, units: units.rows, history: history.rows }
  }
}
