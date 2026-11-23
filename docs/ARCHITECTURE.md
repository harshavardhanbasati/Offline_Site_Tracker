# FieldSync Architecture

## Runtime

```text
React PWA -> IndexedDB (Dexie)
          -> Persistent sync outbox
          -> REST API client
                         |
                         v
                 FastAPI routers
                 SQLAlchemy repositories/services
                         |
                         v
                     PostgreSQL
```

## Database

- `users`: administrators, inspectors, employees
- `sites`: normalized inspection locations
- `site_assignments`: inspector/employee access by site
- `inspections`: title, status, payload, and optimistic version
- `inspection_checklist_items`: normalized checklist results
- `sync_operations`: idempotency keys and operation lifecycle
- `sync_conflicts`: preserved local and server payloads
- `audit_logs`: security and domain event history

All identifiers are UUIDs. Inspection updates are accepted only when the client expected version equals the server version.

## Offline invariants

1. Save user mutations to IndexedDB before network work.
2. Enqueue a stable idempotency key for every mutation.
3. Keep browser connectivity separate from backend reachability.
4. Repeated or refreshed synchronization is safe.
5. Conflicts never silently overwrite server data.
6. Failed operations remain in IndexedDB for bounded retry and manual recovery.

## Synchronization lifecycle

1. Local mutation updates `local_inspections`.
2. Operation is persisted in `sync_outbox`.
3. UI reports pending synchronization.
4. Foreground synchronization detects backend reachability.
5. Batch operations are posted to `/api/sync`.
6. Server processes in transaction and enforces version/idempotency.
7. Frontend acknowledges success or preserves conflict/failure state.
8. Automatic exponential backoff and manual retry handle transient failures.
