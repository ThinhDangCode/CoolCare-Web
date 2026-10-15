export const REVENUE_TIME_ZONE = 'UTC+7'
export const SERVICE_BUCKETS = {
  UNCLASSIFIED: 'Unclassified labor / service',
  UNALLOCATED: 'Unallocated commission',
}
export const UNKNOWN_AREA = { id: 'UNKNOWN_AREA', name: 'Unknown area' }

// Static SQL expression: booking location is used, never technician coverage zones.
export function revenueAreaSql(expression) {
  const normalized = `lower(regexp_replace(trim(COALESCE(${expression}, '')), '[[:space:]]+', ' ', 'g'))`
  return `CASE
    WHEN ${normalized} = '' THEN 'UNKNOWN_AREA'
    WHEN ${normalized} IN ('hồ chí minh','ho chi minh','ho chi minh city','thành phố hồ chí minh','tp.hcm','tp hcm','tphcm','hcm','tp. hồ chí minh','tp hồ chí minh') THEN 'Hồ Chí Minh'
    WHEN ${normalized} IN ('hà nội','ha noi','hanoi','thành phố hà nội','tp. hà nội','tp hà nội') THEN 'Hà Nội'
    WHEN ${normalized} IN ('đà nẵng','da nang','danang','thành phố đà nẵng','tp. đà nẵng','tp đà nẵng') THEN 'Đà Nẵng'
    WHEN ${normalized} IN ('cần thơ','can tho','cantho','thành phố cần thơ','tp. cần thơ','tp cần thơ') THEN 'Cần Thơ'
    ELSE initcap(${normalized}) END`
}
