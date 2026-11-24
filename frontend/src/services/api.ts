import type { Result, Source, Task } from '../types'
import { handleDemoRequest } from './demo'

const API_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:8000'
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false'
const SESSION_KEY = 'webpilot-auth-session'

interface AuthSession {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in?: number
  expires_at?: number
}

interface AuthResponse {
  user: { id: string; email: string; display_name: string }
  session: AuthSession | null
  message: string | null
}

function readSession(): AuthSession | null {
  const stored = sessionStorage.getItem(SESSION_KEY)
  if (!stored) return null
  try {
    return JSON.parse(stored) as AuthSession
  } catch {
    sessionStorage.removeItem(SESSION_KEY)
    return null
  }
}

function saveSession(session: AuthSession | null) {
  if (session?.access_token && session.refresh_token) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } else {
    sessionStorage.removeItem(SESSION_KEY)
  }
}

async function fetchWithAuth(path: string, options?: RequestInit): Promise<Response> {
  if (DEMO_MODE) return handleDemoRequest(path, options)

  const headers = new Headers(options?.headers)
  if (options?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const session = readSession()
  const publicAuthEndpoint = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh'].includes(path)
  if (session?.access_token && !publicAuthEndpoint) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
  let response = await fetch(`${API_URL}${path}`, { ...options, headers })

  if (response.status === 401 && session?.refresh_token && !publicAuthEndpoint) {
    try {
      const refreshed = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      })
      if (!refreshed.ok) throw new Error('Session refresh failed')
      const auth = await refreshed.json() as AuthResponse
      if (!auth.session) throw new Error('Session refresh returned no session')
      saveSession(auth.session)
      headers.set('Authorization', `Bearer ${auth.session.access_token}`)
      response = await fetch(`${API_URL}${path}`, { ...options, headers })
    } catch {
      saveSession(null)
      window.dispatchEvent(new Event('webpilot-auth-expired'))
    }
  } else if (response.status === 401 && !publicAuthEndpoint) {
    saveSession(null)
    window.dispatchEvent(new Event('webpilot-auth-expired'))
  }
  return response
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetchWithAuth(path, options)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail || `Request failed with status ${response.status}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  hasSession: () => DEMO_MODE || Boolean(readSession()?.access_token && readSession()?.refresh_token),
  clearSession: () => saveSession(null),
  register: async (email: string, password: string, displayName: string) => {
    const result = await request<AuthResponse>('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ email, password, display_name: displayName }),
    })
    if (result.session) saveSession(result.session)
    return result
  },
  login: async (email: string, password: string) => {
    const result = await request<AuthResponse>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    })
    if (result.session) saveSession(result.session)
    return result
  },
  currentUser: () => request<{ id: string; email: string; display_name: string }>('/api/auth/me'),
  logout: async () => {
    try { await request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }) }
    finally { saveSession(null) }
  },
  health: () => request<{
    status: string
    providers: {
      llm: { provider: string; configured: boolean }
      search: { provider: string; configured: boolean }
      auth: { provider: string; configured: boolean }
      database: string
    }
  }>('/api/health'),
  getTask: (id: string) => request<Task>(`/api/tasks/${id}`),
  listTasks: () => request<Task[]>('/api/tasks'),
  createTask: (instruction: string) =>
    request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify({ instruction }) }),
  executeTask: (id: string) =>
    request<Task>(`/api/tasks/${id}/execute`, { method: 'POST' }),
  cancelTask: (id: string) => request<{ id: string; status: string }>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  getResults: (id: string) => request<Result>(`/api/tasks/${id}/results`),
  getSources: (id: string) => request<Source[]>(`/api/tasks/${id}/sources`),
  deleteTask: (id: string) => request<{ deleted: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' }),
  clearTasks: () => request<{ deleted: boolean }>('/api/tasks', { method: 'DELETE' }),
  analytics: () => request<{
    total_workflows: number; completed_workflows: number; failed_workflows: number;
    average_execution_seconds: number | null; sources_collected: number;
    verified_findings: number; agent_executions: number; calculation_notes: string;
  }>('/api/analytics'),
  agents: () => request<{
    id: number; task_id: string; agent: string; step: string; status: string;
    attempts: number; error: string; output: Record<string, unknown>; created_at: string; updated_at: string
  }[]>('/api/agents'),
  analyzeBrowserPage: (title: string, url: string, text: string, question = '') =>
    request<{ title: string; url: string; answer: string; mode: string; notice: string }>('/api/browser/analyze', {
      method: 'POST', body: JSON.stringify({ title, url, text, question }),
    }),
  verifyTask: (id: string) => request<{ findings: { claim: string; confidence: number; verification_status: string; source_url: string | null }[] }>(`/api/tasks/${id}/verify`, { method: 'POST' }),
  createReport: (id: string, reportType: string) =>
    request<{ id: string; task_id: string; title: string; report_type: string; content: Record<string, unknown> }>(
      `/api/tasks/${id}/reports?report_type=${encodeURIComponent(reportType)}`, { method: 'POST' }),
  reports: () => request<{ id: string; task_id: string; title: string; report_type: string; content: Record<string, unknown> }[]>('/api/reports'),
  deleteReport: (id: string) => request<{ deleted: boolean }>(`/api/reports/${id}`, { method: 'DELETE' }),
  exportReport: async (id: string, format: 'csv' | 'pdf') => {
    const response = await fetchWithAuth(`/api/reports/${id}/export?format=${format}`)
    if (!response.ok) throw new Error(`Report export failed (${response.status})`)
    return response.blob()
  },
  templates: () => request<{ id: string; name: string; instruction: string }[]>('/api/templates'),
  createTemplate: (name: string, instruction: string) =>
    request<{ id: string; name: string; instruction: string }>('/api/templates', {
      method: 'POST', body: JSON.stringify({ name, instruction }),
    }),
  deleteTemplate: (id: string) => request<{ deleted: boolean }>(`/api/templates/${id}`, { method: 'DELETE' }),
  preferences: () => request<Record<string, string>>('/api/preferences'),
  savePreferences: (preferences: Record<string, string>) =>
    request<Record<string, string>>('/api/preferences', { method: 'PUT', body: JSON.stringify({ preferences }) }),
  audit: () => request<{ id: number; task_id: string | null; event_type: string; details: Record<string, unknown>; created_at: string }[]>('/api/security/audit'),
  approvals: () => request<{ id: string; action: string; details: Record<string, unknown>; status: string; created_at: string }[]>('/api/approvals'),
  requestApproval: (action: string) =>
    request<{ id: string; status: string; action: string }>('/api/approvals', {
      method: 'POST', body: JSON.stringify({ action, details: { note: 'Demo approval request; no external action is performed.' } }),
    }),
  decideApproval: (id: string, decision: 'approved' | 'rejected') =>
    request<{ id: string; status: string; note: string }>(`/api/approvals/${id}/decision`, {
      method: 'POST', body: JSON.stringify({ decision }),
    }),
}
