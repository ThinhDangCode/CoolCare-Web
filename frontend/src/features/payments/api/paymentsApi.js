import { adminRequest } from '../../../shared/api/adminApi.js'
import { revenueFilename, revenueRowCount } from '../revenueReport.js'

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')
const workbookType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function listPayments(query, token, signal) {
  return adminRequest(`/payments?${query}`, token, { signal })
}

export function getPayment(id, token, signal) {
  return adminRequest(`/payments/${encodeURIComponent(id)}`, token, { signal })
}

export async function exportRevenueReport({ from, to, method, search }, token, signal) {
  const query = new URLSearchParams({ from, to, method, search })
  let response
  try {
    response = await fetch(`${apiBase}/admin/payments/export?${query}`, {
      method: 'GET',
      signal,
      headers: { Authorization: `Bearer ${token}`, Accept: workbookType },
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Unable to connect to the server. Please try again.', { cause: error })
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const error = new Error(payload.error?.message ?? 'Unable to export the revenue report.')
    error.status = response.status
    error.code = payload.error?.code
    error.details = payload.error?.details ?? {}
    throw error
  }
  if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== workbookType) {
    throw new Error('The server did not return an Excel workbook. Please try again.')
  }
  const blob = await response.blob()
  if (!blob.size) throw new Error('The report file is empty. Please try again.')
  return {
    blob,
    filename: revenueFilename(response.headers.get('Content-Disposition'), from, to),
    rowCount: revenueRowCount(response.headers.get('X-Report-Row-Count')),
  }
}
