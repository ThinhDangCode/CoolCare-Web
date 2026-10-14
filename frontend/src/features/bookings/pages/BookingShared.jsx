import { bookingStatusLabels } from './bookingFormat.js'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
export function BookingStatus({ status }) {
  const { t } = useUiPreferences()
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
      {t(bookingStatusLabels[status] || status)}
    </span>
  )
}
