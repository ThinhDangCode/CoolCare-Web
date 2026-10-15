import { adminRequest } from '../../management/api/managementApi.js'

export function listTopups(query, token, signal) {
  return adminRequest(`/topups?${query}`, token, { signal })
}

export function getTopup(id, token, signal) {
  return adminRequest(`/topups/${encodeURIComponent(id)}`, token, { signal })
}
