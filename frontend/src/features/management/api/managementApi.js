const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api').replace(
  /\/$/,
  ''
)

export async function adminRequest(path, token, { method = 'GET', body, signal } = {}) {
  let response
  try {
    response = await fetch(`${apiBase}/admin${path}`, {
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
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? 'Yêu cầu không thành công.')
    error.status = response.status
    error.details = payload.error?.details ?? {}
    throw error
  }
  return payload.data
}
