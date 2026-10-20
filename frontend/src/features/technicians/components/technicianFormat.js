const labels = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced',
  EXPERT: 'Expert',
  PENDING: 'Pending review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  EXPIRING: 'Expiring soon',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  LOCKED: 'Blocked',
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  BUSY: 'Busy',
}
export const label = (value) => labels[value] ?? value ?? '—'
export const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB') : '—')
export function safeDocumentUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
