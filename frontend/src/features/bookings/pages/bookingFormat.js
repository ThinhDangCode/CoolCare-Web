export const bookingStatusLabels = {
  PENDING: 'Pending',
  TECHNICIAN_SELECTED: 'Technician Selected',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In Progress',
  WAITING_QUOTATION: 'Waiting Quotation',
  QUOTATION_SENT: 'Quotation Sent',
  QUOTATION_ACCEPTED: 'Quotation Accepted',
  QUOTATION_REJECTED: 'Quotation Rejected',
  WAITING_CONFIRMATION: 'Waiting Confirmation',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}
export const money = (value) => `${new Intl.NumberFormat('en-US').format(Number(value || 0))}₫`
export const date = (value) =>
  value ? new Date(value).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—'
export const time = (value) =>
  value
    ? new Date(value).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
      })
    : '—'
