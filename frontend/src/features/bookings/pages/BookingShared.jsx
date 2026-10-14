import { bookingStatusLabels } from './bookingFormat.js'
export function BookingStatus({ status }) {
  const tone =
    status === 'CANCELLED'
      ? 'cancelled'
      : status === 'COMPLETED'
        ? 'completed'
        : ['PENDING', 'TECHNICIAN_SELECTED'].includes(status)
          ? 'pending'
          : 'progress'
  return (
    <span className={`booking-status ${tone}`}>
      <i />
      {bookingStatusLabels[status] || status}
    </span>
  )
}
