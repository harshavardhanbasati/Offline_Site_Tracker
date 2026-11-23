export type Role = 'administrator' | 'inspector' | 'employee'

export interface User {
  id: string
  email: string
  full_name: string
  role: Role
  is_active: boolean
  created_at: string
}

export interface Site {
  id: string
  name: string
  code: string
  address: string
  latitude: number | null
  longitude: number | null
  status: 'active' | 'inactive' | 'planned'
  version: number
  created_at: string
  updated_at: string
}

export interface ChecklistItem {
  id?: string
  label: string
  status: 'pending' | 'passed' | 'failed' | 'not_applicable'
  notes?: string | null
  sort_order: number
}

export interface Inspection {
  id: string
  site_id: string
  inspector_id: string
  title: string
  status: 'draft' | 'in_progress' | 'completed'
  data: Record<string, unknown>
  version: number
  submitted_at: string | null
  created_at: string
  updated_at: string
  checklist: ChecklistItem[]
  syncStatus?: 'draft' | 'pending' | 'synchronized' | 'conflict' | 'failed'
  serverVersion?: number
}

export interface OutboxOperation {
  id?: number
  idempotencyKey: string
  operation: 'create_inspection' | 'update_inspection'
  entityId: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'synchronized' | 'conflict' | 'failed'
  retryCount: number
  nextAttemptAt: number
  lastError?: string
  createdAt: number
  updatedAt: number
}
