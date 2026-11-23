import { api, isAuthenticatedByToken } from './api'
import { db } from './db'
import type { Inspection, OutboxOperation } from './types'

let lock = false

export async function enqueueMutation(
  operation: OutboxOperation['operation'],
  inspection: Inspection,
  role: 'administrator' | 'inspector' | 'employee' = 'inspector',
) {
  const now = Date.now()
  const payload = operation === 'create_inspection'
    ? { id: inspection.id, site_id: inspection.site_id, title: inspection.title, status: inspection.status, data: inspection.data, checklist: inspection.checklist }
    : role === 'employee'
      ? { id: inspection.id, expected_version: inspection.serverVersion ?? inspection.version, status: inspection.status }
      : { id: inspection.id, expected_version: inspection.serverVersion ?? inspection.version, title: inspection.title, status: inspection.status, data: inspection.data, checklist: inspection.checklist }
  await db.transaction('rw', db.local_inspections, db.sync_outbox, async () => {
    await db.local_inspections.put({ ...inspection, syncStatus: 'pending' })
    await db.sync_outbox.add({
      idempotencyKey: `${operation}:${inspection.id}:${now}`,
      operation,
      entityId: inspection.id,
      payload,
      status: 'pending',
      retryCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
  })
  await db.sync_metadata.put({ key: 'last_mutation_at', value: String(now), updatedAt: now })
}

export async function retryFailed() {
  const failed = await db.sync_outbox.where('status').equals('failed').toArray()
  await db.transaction('rw', db.sync_outbox, async () => {
    for (const item of failed) {
      await db.sync_outbox.update(item.id!, { status: 'pending', retryCount: 0, nextAttemptAt: Date.now(), updatedAt: Date.now(), lastError: undefined })
    }
  })
}

export async function synchronize() {
  if (lock || !navigator.onLine || !isAuthenticatedByToken()) return { synchronized: 0, failed: 0, conflicts: 0 }
  lock = true
  const summary = { synchronized: 0, failed: 0, conflicts: 0 }
  try {
    await api.health()
    const now = Date.now()
    const operations = await db.sync_outbox
      .where('status')
      .anyOf(['pending', 'failed'])
      .filter((item) => item.nextAttemptAt <= now)
      .limit(50)
      .toArray()
    if (!operations.length) return summary
    await db.transaction('rw', db.sync_outbox, async () => {
      for (const item of operations) await db.sync_outbox.update(item.id!, { status: 'processing', updatedAt: now })
    })
    const response = await api.sync(operations.map((item) => ({
      idempotency_key: item.idempotencyKey,
      operation: item.operation,
      entity_id: item.entityId,
      payload: item.payload,
    })))
    for (const result of response.results) {
      const item = operations.find((entry) => entry.idempotencyKey === result.idempotency_key)
      if (!item) continue
      if (result.status === 'synchronized') {
        await db.sync_outbox.delete(item.id!)
        const local = await db.local_inspections.get(item.entityId)
        if (local) await db.local_inspections.put({ ...local, syncStatus: 'synchronized', serverVersion: result.version ?? local.serverVersion, version: result.version ?? local.version })
        summary.synchronized += 1
      } else if (result.status === 'conflict') {
        await db.sync_outbox.update(item.id!, { status: 'conflict', lastError: result.error ?? 'Version conflict', updatedAt: Date.now() })
        await db.local_inspections.update(item.entityId, { syncStatus: 'conflict' })
        summary.conflicts += 1
      } else {
        const retryCount = item.retryCount + 1
        await db.sync_outbox.update(item.id!, {
          status: 'failed',
          retryCount,
          nextAttemptAt: Date.now() + Math.min(60_000, 2 ** retryCount * 1000),
          lastError: result.error ?? 'Synchronization failed',
          updatedAt: Date.now(),
        })
        await db.local_inspections.update(item.entityId, { syncStatus: 'failed' })
        summary.failed += 1
      }
    }
  } catch (error) {
    const operations = await db.sync_outbox.where('status').equals('processing').toArray()
    for (const item of operations) {
      await db.sync_outbox.update(item.id!, { status: 'pending', nextAttemptAt: Date.now() + 5000, lastError: error instanceof Error ? error.message : 'Network failure', updatedAt: Date.now() })
    }
  } finally {
    if (summary.synchronized) await db.sync_metadata.put({ key: 'last_successful_sync', value: String(Date.now()), updatedAt: Date.now() })
    lock = false
  }
  return summary
}
