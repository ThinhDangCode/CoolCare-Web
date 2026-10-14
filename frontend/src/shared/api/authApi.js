const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details ?? {}
  }
}

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

async function waitForApiReady(maxAttempts = 7) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${apiBaseUrl}/health`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (response.ok) return
    } catch {
      // The API may still be starting and establishing its first database connection.
    }

    if (attempt < maxAttempts - 1) await wait(Math.min(250 * 2 ** attempt, 1_500))
  }

  throw new ApiError({
    status: 0,
    code: 'NETWORK_ERROR',
    message: 'Unable to connect to CoolCare right now. Please try again in a moment.',
  })
}

async function request(path, { method = 'GET', body, token, networkRetries = 0 } = {}) {
  let response
  for (let attempt = 0; attempt <= networkRetries; attempt += 1) {
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
      break
    } catch {
      if (attempt === networkRetries)
        throw new ApiError({
          status: 0,
          code: 'NETWORK_ERROR',
          message: 'Unable to connect to CoolCare right now. Please try again in a moment.',
        })
      await wait(500)
    }
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
  async login(credentials) {
    await waitForApiReady()
    return request('/auth/login', { method: 'POST', body: credentials, networkRetries: 2 })
  },
  logout(token) {
    return request('/auth/logout', { method: 'POST', token })
  },
  refresh(token) {
    return request('/auth/refresh', { method: 'POST', token })
  },
  getProfile(token) {
    return request('/auth/profile', { token })
  },
  updateProfile(token, profile) {
    return request('/auth/profile', { method: 'PATCH', body: profile, token })
  },
  updateAvatar(token, avatarUrl) {
    return request('/auth/profile/avatar', { method: 'PATCH', body: { avatarUrl }, token })
  },
  changePassword(token, passwords) {
    return request('/auth/change-password', { method: 'POST', body: passwords, token })
  },
}
