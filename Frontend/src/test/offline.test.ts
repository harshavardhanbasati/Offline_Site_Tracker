import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { enqueueMutation } from '../sync'
import type { Inspection } from '../types'

const inspection: Inspection = {
  id: '12ef4d8a-4d9c-4f2a-bdd4-18c13ec5d0a1',
  site_id: '11ef4d8a-4d9c-4f2a-bdd4-18c13ec5d0a1',
  inspector_id: '10ef4d8a-4d9c-4f2a-bdd4-18c13ec5d0a1',
  title: 'Offline persistence test',
  status: 'draft',
  data: { source: 'local' },
  version: 1,
  submitted_at: null,
  created_at: '2026-11-23T00:00:00Z',
  updated_at: '2026-11-23T00:00:00Z',
  checklist: [{ label: 'Site access', status: 'pending', sort_order: 0 }],
  syncStatus: 'draft',
  serverVersion: 1,
}

describe('offline persistence', () => {
  beforeEach(async () => {
    await db.sync_outbox.clear()
    await db.local_inspections.clear()
  })

  it('persists a local draft and outbox operation before network work', async () => {
    await enqueueMutation('create_inspection', inspection)

    expect(await db.local_inspections.get(inspection.id)).toMatchObject({
      id: inspection.id,
      title: 'Offline persistence test',
      syncStatus: 'pending',
    })
    const operations = await db.sync_outbox.toArray()
    expect(operations).toHaveLength(1)
    expect(operations[0].operation).toBe('create_inspection')
    expect(operations[0].status).toBe('pending')
    expect(operations[0].payload.title).toBe('Offline persistence test')
  })
})
