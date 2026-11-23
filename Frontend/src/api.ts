import type { Inspection, Role, Site, User } from './types'

const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:8000'
let accessToken: string | null = null
let refreshToken: string | null = null

export function setSession(tokens: { access_token: string; refresh_token: string }) {
  accessToken = tokens.access_token
  refreshToken = tokens.refresh_token
}

export function clearSession() {
  accessToken = null
  refreshToken = null
}

export function isAuthenticatedByToken() {
  return accessToken !== null
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: 'include' })
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = await response.json()
      message = body?.error?.message ?? body?.detail ?? message
      if (typeof message === 'object') message = JSON.stringify(message)
    } catch {
      // Keep status fallback.
    }
    throw new Error(String(message))
  }
  return response.json() as Promise<T>
}

export const api = {
  login: (email: string, password: string) =>
    request<{ access_token: string; refresh_token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (fullName: string, email: string, password: string, role: 'inspector' | 'employee') =>
    request<{ access_token: string; refresh_token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ full_name: fullName, email, password, role }),
    }),
  refresh: () => refreshToken
    ? request<{ access_token: string; refresh_token: string }>('/api/auth/refresh', { method: 'POST', body: '{}' })
    : request<{ access_token: string; refresh_token: string }>('/api/auth/refresh', { method: 'POST', body: '{}' }),
  me: () => request<User>('/api/auth/me'),
  health: () => request<{ status: string }>('/api/health'),
  sites: (search = '') => request<Site[]>(`/api/sites${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  inspections: () => request<Inspection[]>('/api/inspections'),
  syncStatus: () => request<{ pending: number; synchronized: number; failed: number; conflicts: number; last_successful_sync: string | null }>('/api/sync/status'),
  syncHistory: () => request<Array<Record<string, unknown>>>('/api/sync/history'),
  conflicts: () => request<Array<Record<string, unknown>>>('/api/sync/conflicts'),
  sync: (operations: Array<{ idempotency_key: string; operation: string; entity_id: string | null; payload: Record<string, unknown> }>) =>
    request<{ results: Array<{ idempotency_key: string; status: 'synchronized' | 'conflict' | 'failed'; entity_id: string | null; version: number | null; conflict_id: string | null; error: string | null }> }>(
      '/api/sync',
      { method: 'POST', body: JSON.stringify({ operations }) },
    ),
  resolveConflict: (id: string, resolution: 'accept_server' | 'accept_local') =>
    request<Record<string, unknown>>(`/api/sync/conflicts/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution, note: 'Resolved from Sync Center' }),
    }),
  activity: () => request<Array<Record<string, unknown>>>('/api/activity'),
  report: () => request<Record<string, unknown>>('/api/reports/summary'),
  users: () => request<User[]>('/api/admin/users'),
  createUser: (payload: { email: string; full_name: string; password: string; role: Role }) =>
    request<User>('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: { full_name?: string; role?: Role; is_active?: boolean }) =>
    request<User>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  removeUser: (id: string) =>
    request<null>(`/api/admin/users/${id}`, { method: 'DELETE' }),
  assignSite: (payload: { site_id: string; user_id: string }) =>
    request<Record<string, unknown>>('/api/admin/assignments', { method: 'POST', body: JSON.stringify(payload) }),
  removeAssignment: (siteId: string, userId: string) =>
    request<Record<string, unknown>>(`/api/admin/assignments?site_id=${encodeURIComponent(siteId)}&user_id=${encodeURIComponent(userId)}`, { method: 'DELETE' }),
}
