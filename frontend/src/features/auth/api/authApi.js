const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details ?? {}
  }
}

async function request(path, { method = 'GET', body, token } = {}) {
  let response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Không thể kết nối máy chủ CoolCare.' })
  }

  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      code: payload.error?.code ?? 'REQUEST_FAILED',
      message: payload.error?.message ?? 'Yêu cầu không thành công.',
      details: payload.error?.details,
    })
  }
  return payload.data
}

export const authApi = {
  login(credentials) {
    return request('/auth/login', { method: 'POST', body: credentials })
  },
  logout(token) {
    return request('/auth/logout', { method: 'POST', token })
  },
}
