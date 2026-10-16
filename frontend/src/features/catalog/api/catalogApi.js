const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

export async function catalogRequest(path, token, { method = 'GET', body, signal } = {}) {
  let response
  try {
    response = await fetch(`${base}/admin/catalog${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Không thể kết nối máy chủ. Vui lòng thử lại.', { cause: error })
  }
  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? 'Yêu cầu không thành công.')
    error.details = payload.error?.details ?? {}
    error.status = response.status
    throw error
  }
  return payload.data
}
