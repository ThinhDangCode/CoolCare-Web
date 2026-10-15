import { adminRequest } from '../../../shared/api/adminApi.js'

export function listTopups(query, token, signal) {
  return adminRequest(`/topups?${query}`, token, { signal })
}

export function getTopup(id, token, signal) {
  return adminRequest(`/topups/${encodeURIComponent(id)}`, token, { signal })
}
