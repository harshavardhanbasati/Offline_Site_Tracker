import Dexie, { type EntityTable } from 'dexie'
import type { Inspection, OutboxOperation, Site } from './types'

export interface SyncMetadata {
  key: string
  value: string
  updatedAt: number
}

export class FieldSyncDb extends Dexie {
  cached_sites!: EntityTable<Site, 'id'>
  local_inspections!: EntityTable<Inspection, 'id'>
  sync_outbox!: EntityTable<OutboxOperation, 'id'>
  sync_metadata!: EntityTable<SyncMetadata, 'key'>

  constructor() {
    super('FieldSyncOffline')
    this.version(1).stores({
      cached_sites: 'id, code, name, status, updated_at',
      local_inspections: 'id, site_id, status, syncStatus, updated_at',
      sync_outbox: '++id, &idempotencyKey, entityId, status, nextAttemptAt, operation',
      sync_metadata: '&key, updatedAt',
    })
  }
}

export const db = new FieldSyncDb()
