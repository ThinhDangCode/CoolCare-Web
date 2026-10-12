export const REPORT_ROW_LIMIT = 10_000
export const REPORT_TIMEZONE = 'Vietnam time (UTC+7)'
// Static SQL column allowlist; no column names come from request parameters.
export const REVENUE_METRICS = [
  { key: 'paymentAmount', column: 'amount', label: 'Gross successful payment amount' },
  { key: 'commission', column: 'commission_amount', label: 'Commission snapshot' },
  { key: 'platformDiscount', column: 'platform_discount_amount', label: 'Platform discount snapshot' },
  { key: 'technicianEarning', column: 'technician_earning', label: 'Technician entitlement snapshot' },
]
