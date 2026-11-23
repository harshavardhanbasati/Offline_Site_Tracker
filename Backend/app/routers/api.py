from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, require_roles
from app.core.config import get_settings
from app.core.security import create_access_token, create_refresh_token, decode_token, hash_password, verify_password
from app.db.session import get_db
from app.models.entities import (
    AuditLog,
    Inspection,
    InspectionChecklistItem,
    Site,
    SiteAssignment,
    SyncConflict,
    SyncOperation,
    User,
)
from app.schemas.common import (
    ConflictResolution,
    InspectionCreate,
    InspectionOut,
    InspectionUpdate,
    Login,
    Refresh,
    Register,
    SiteCreate,
    SiteOut,
    SiteUpdate,
    SyncBatch,
    Tokens,
    UserCreate,
    UserOut,
)


router = APIRouter()


def serialize_inspection(db: Session, inspection: Inspection) -> dict:
    items = list(db.scalars(
        select(InspectionChecklistItem)
        .where(InspectionChecklistItem.inspection_id == inspection.id)
        .order_by(InspectionChecklistItem.sort_order)
    ))
    return {
        "id": str(inspection.id),
        "site_id": str(inspection.site_id),
        "inspector_id": str(inspection.inspector_id),
        "title": inspection.title,
        "status": inspection.status,
        "data": inspection.data,
        "version": inspection.version,
        "submitted_at": inspection.submitted_at.isoformat() if inspection.submitted_at else None,
        "created_at": inspection.created_at.isoformat(),
        "updated_at": inspection.updated_at.isoformat(),
        "checklist": [
            {"id": str(item.id), "label": item.label, "status": item.status, "notes": item.notes, "sort_order": item.sort_order}
            for item in items
        ],
    }


@router.post("/api/auth/register", response_model=Tokens)
def register(payload: Register, response: Response, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    user = User(
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(AuditLog(
        user_id=user.id,
        action="auth.register",
        entity_type="user",
        entity_id=user.id,
        details={"role": payload.role},
    ))
    db.commit()

    refresh_token = create_refresh_token(user.id)
    response.set_cookie(
        "fieldsync_refresh",
        refresh_token,
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="lax",
        max_age=get_settings().refresh_token_days * 24 * 60 * 60,
        path="/api/auth",
    )
    return Tokens(
        access_token=create_access_token(user.id, user.role),
        refresh_token=refresh_token,
    )


@router.post("/api/auth/login", response_model=Tokens)
def login(payload: Login, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    db.add(AuditLog(user_id=user.id, action="auth.login", entity_type="user", entity_id=user.id, details={"ok": True}))
    db.commit()
    refresh_token = create_refresh_token(user.id)
    response.set_cookie(
        "fieldsync_refresh",
        refresh_token,
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="lax",
        max_age=get_settings().refresh_token_days * 24 * 60 * 60,
        path="/api/auth",
    )
    return Tokens(access_token=create_access_token(user.id, user.role), refresh_token=refresh_token)


@router.post("/api/auth/refresh", response_model=Tokens)
def refresh(payload: Refresh, response: Response, fieldsync_refresh: str | None = Cookie(default=None), db: Session = Depends(get_db)):
    refresh_token = payload.refresh_token or fieldsync_refresh
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Refresh token required")
    try:
        token_payload = decode_token(refresh_token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    if token_payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = db.get(User, UUID(token_payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Inactive or unknown user")
    new_refresh_token = create_refresh_token(user.id)
    response.set_cookie(
        "fieldsync_refresh",
        new_refresh_token,
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="lax",
        max_age=get_settings().refresh_token_days * 24 * 60 * 60,
        path="/api/auth",
    )
    return Tokens(access_token=create_access_token(user.id, user.role), refresh_token=new_refresh_token)


@router.get("/api/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.get("/api/sites", response_model=list[SiteOut])
def sites(search: str | None = Query(default=None), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = select(Site)
    if user.role in ("inspector", "employee"):
        statement = statement.join(SiteAssignment, SiteAssignment.site_id == Site.id).where(SiteAssignment.user_id == user.id)
    if search:
        term = f"%{search.lower()}%"
        statement = statement.where(Site.name.lower().like(term) | Site.code.lower().like(term))
    return list(db.scalars(statement.order_by(Site.name)).unique())


@router.get("/api/sites/{site_id}", response_model=SiteOut)
def site(site_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    value = db.get(Site, site_id)
    if value is None:
        raise HTTPException(status_code=404, detail="Site not found")
    if user.role in ("inspector", "employee"):
        assignment = db.scalar(select(SiteAssignment).where(SiteAssignment.site_id == site_id, SiteAssignment.user_id == user.id))
        if assignment is None:
            raise HTTPException(status_code=403, detail="Site is not assigned")
    return value


@router.post("/api/sites", response_model=SiteOut, status_code=201)
def create_site(payload: SiteCreate, db: Session = Depends(get_db), user: User = Depends(require_roles("administrator"))):
    if db.scalar(select(Site).where(Site.code == payload.code)):
        raise HTTPException(status_code=409, detail="Site code already exists")
    value = Site(**payload.model_dump())
    db.add(value)
    db.flush()
    db.add(AuditLog(user_id=user.id, action="site.created", entity_type="site", entity_id=value.id, details={"code": value.code}))
    db.commit()
    db.refresh(value)
    return value


@router.patch("/api/sites/{site_id}", response_model=SiteOut)
def update_site(site_id: UUID, payload: SiteUpdate, db: Session = Depends(get_db), user: User = Depends(require_roles("administrator"))):
    value = db.get(Site, site_id)
    if value is None:
        raise HTTPException(status_code=404, detail="Site not found")
    changes = payload.model_dump(exclude_unset=True)
    for field, item in changes.items():
        setattr(value, field, item)
    value.version += 1
    db.add(AuditLog(user_id=user.id, action="site.updated", entity_type="site", entity_id=value.id, details=changes))
    db.commit()
    db.refresh(value)
    return value


@router.get("/api/inspections", response_model=list[InspectionOut])
def inspections(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = select(Inspection)
    if user.role in ("inspector", "employee"):
        statement = statement.where(Inspection.inspector_id == user.id)
    rows = list(db.scalars(statement.order_by(Inspection.updated_at.desc())).unique())
    return [serialize_inspection(db, row) for row in rows]


@router.post("/api/inspections", response_model=InspectionOut, status_code=201)
def create_inspection(payload: InspectionCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "employee":
        raise HTTPException(status_code=403, detail="Employees can complete assigned tasks but cannot create inspections")
    if user.role in ("inspector", "employee"):
        assignment = db.scalar(select(SiteAssignment).where(SiteAssignment.site_id == payload.site_id, SiteAssignment.user_id == user.id))
        if assignment is None:
            raise HTTPException(status_code=403, detail="Site is not assigned")
    value = Inspection(id=payload.id or uuid4(), site_id=payload.site_id, inspector_id=user.id, title=payload.title, status=payload.status, data=payload.data)
    db.add(value)
    db.flush()
    for item in payload.checklist:
        db.add(InspectionChecklistItem(inspection_id=value.id, label=item.label, status=item.status, notes=item.notes, sort_order=item.sort_order))
    db.add(AuditLog(user_id=user.id, action="inspection.created", entity_type="inspection", entity_id=value.id, details={"site_id": str(payload.site_id)}))
    db.commit()
    db.refresh(value)
    return serialize_inspection(db, value)


@router.get("/api/inspections/{inspection_id}", response_model=InspectionOut)
def inspection(inspection_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    value = db.get(Inspection, inspection_id)
    if value is None:
        raise HTTPException(status_code=404, detail="Inspection not found")
    if user.role in ("inspector", "employee") and value.inspector_id != user.id:
        raise HTTPException(status_code=403, detail="Inspection is not owned")
    return serialize_inspection(db, value)


@router.patch("/api/inspections/{inspection_id}", response_model=InspectionOut)
def update_inspection(inspection_id: UUID, payload: InspectionUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    value = db.get(Inspection, inspection_id)
    if value is None:
        raise HTTPException(status_code=404, detail="Inspection not found")
    if user.role in ("inspector", "employee") and value.inspector_id != user.id:
        raise HTTPException(status_code=403, detail="Inspection is not owned")
    if user.role == "employee" and ("title" in payload.model_dump(exclude_unset=True) or "checklist" in payload.model_dump(exclude_unset=True)):
        raise HTTPException(status_code=403, detail="Employees may update task completion status only")
    if value.version != payload.expected_version:
        raise HTTPException(status_code=409, detail={"server_version": value.version, "expected_version": payload.expected_version})
    changes = payload.model_dump(exclude_unset=True)
    changes.pop("expected_version", None)
    checklist = changes.pop("checklist", None)
    for field, item in changes.items():
        setattr(value, field, item)
    if payload.status == "completed":
        value.submitted_at = datetime.now(timezone.utc)
    if checklist is not None:
        db.query(InspectionChecklistItem).filter(InspectionChecklistItem.inspection_id == value.id).delete(synchronize_session=False)
        for item in checklist:
            db.add(InspectionChecklistItem(inspection_id=value.id, label=item["label"], status=item["status"], notes=item.get("notes"), sort_order=item["sort_order"]))
    value.version += 1
    db.add(AuditLog(user_id=user.id, action="inspection.updated", entity_type="inspection", entity_id=value.id, details=changes))
    db.commit()
    db.refresh(value)
    return serialize_inspection(db, value)


@router.post("/api/sync")
def synchronize(batch: SyncBatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    results = []
    for item in batch.operations:
        existing = db.scalar(select(SyncOperation).where(SyncOperation.idempotency_key == item.idempotency_key))
        if existing:
            conflict = db.scalar(select(SyncConflict).where(SyncConflict.operation_id == existing.id))
            results.append({
                "idempotency_key": item.idempotency_key,
                "status": "conflict" if existing.status == "conflict" else "synchronized" if existing.status == "synchronized" else "failed",
                "entity_id": existing.entity_id,
                "version": None,
                "conflict_id": conflict.id if conflict else None,
                "error": existing.last_error,
            })
            continue

        operation = SyncOperation(
            idempotency_key=item.idempotency_key,
            user_id=user.id,
            entity_id=item.entity_id,
            operation=item.operation,
            payload=item.payload,
            status="processing",
            attempt_count=1,
        )
        db.add(operation)
        db.flush()
        try:
            if item.operation == "create_inspection":
                payload = item.payload
                if user.role == "employee":
                    raise HTTPException(status_code=403, detail="Employees cannot create inspections")
                inspection_id = UUID(str(payload["id"])) if payload.get("id") else (item.entity_id or uuid4())
                if user.role in ("inspector", "employee"):
                    assignment = db.scalar(select(SiteAssignment).where(SiteAssignment.site_id == UUID(str(payload["site_id"])), SiteAssignment.user_id == user.id))
                    if assignment is None:
                        raise HTTPException(status_code=403, detail="Site is not assigned")
                value = db.get(Inspection, inspection_id)
                if value is None:
                    value = Inspection(
                        id=inspection_id,
                        site_id=UUID(str(payload["site_id"])),
                        inspector_id=user.id,
                        title=payload["title"],
                        status=payload.get("status", "draft"),
                        data=payload.get("data", {}),
                    )
                    db.add(value)
                    db.flush()
                    for checklist in payload.get("checklist", []):
                        db.add(InspectionChecklistItem(
                            inspection_id=value.id,
                            label=checklist["label"],
                            status=checklist.get("status", "pending"),
                            notes=checklist.get("notes"),
                            sort_order=checklist.get("sort_order", 0),
                        ))
                operation.entity_id = value.id
                operation.status = "synchronized"
                operation.completed_at = datetime.now(timezone.utc)
                db.add(AuditLog(user_id=user.id, action="inspection.synchronized", entity_type="inspection", entity_id=value.id, details={"idempotency_key": item.idempotency_key}))
                db.commit()
                results.append({"idempotency_key": item.idempotency_key, "status": "synchronized", "entity_id": value.id, "version": value.version, "conflict_id": None, "error": None})
            else:
                if user.role == "employee":
                    forbidden_fields = {"title", "checklist", "data"} & set(payload)
                    if forbidden_fields:
                        raise HTTPException(status_code=403, detail="Employees may only update task completion status")
                payload = item.payload
                inspection_id = item.entity_id or UUID(str(payload["id"]))
                value = db.get(Inspection, inspection_id)
                if value is None:
                    raise HTTPException(status_code=404, detail="Inspection not found")
                expected = int(payload["expected_version"])
                if value.version != expected:
                    conflict = SyncConflict(
                        inspection_id=value.id,
                        operation_id=operation.id,
                        local_payload=payload,
                        server_payload=serialize_inspection(db, value),
                    )
                    db.add(conflict)
                    operation.entity_id = value.id
                    operation.status = "conflict"
                    operation.last_error = f"Version conflict: local {expected}, server {value.version}"
                    db.add(AuditLog(user_id=user.id, action="sync.conflict_detected", entity_type="inspection", entity_id=value.id, details={"expected": expected, "server": value.version}))
                    db.commit()
                    results.append({"idempotency_key": item.idempotency_key, "status": "conflict", "entity_id": value.id, "version": value.version, "conflict_id": conflict.id, "error": operation.last_error})
                else:
                    if "title" in payload:
                        value.title = payload["title"]
                    if "status" in payload:
                        value.status = payload["status"]
                        if payload["status"] == "completed":
                            value.submitted_at = datetime.now(timezone.utc)
                    if "data" in payload:
                        value.data = payload["data"]
                    if "checklist" in payload:
                        db.query(InspectionChecklistItem).filter(InspectionChecklistItem.inspection_id == value.id).delete(synchronize_session=False)
                        for checklist in payload["checklist"]:
                            db.add(InspectionChecklistItem(
                                inspection_id=value.id,
                                label=checklist["label"],
                                status=checklist.get("status", "pending"),
                                notes=checklist.get("notes"),
                                sort_order=checklist.get("sort_order", 0),
                            ))
                    value.version += 1
                    operation.entity_id = value.id
                    operation.status = "synchronized"
                    operation.completed_at = datetime.now(timezone.utc)
                    db.add(AuditLog(user_id=user.id, action="inspection.synchronized", entity_type="inspection", entity_id=value.id, details={"idempotency_key": item.idempotency_key}))
                    db.commit()
                    results.append({"idempotency_key": item.idempotency_key, "status": "synchronized", "entity_id": value.id, "version": value.version, "conflict_id": None, "error": None})
        except HTTPException as exc:
            db.rollback()
            operation.status = "failed"
            operation.last_error = str(exc.detail)
            db.add(operation)
            db.commit()
            results.append({"idempotency_key": item.idempotency_key, "status": "failed", "entity_id": operation.entity_id, "version": None, "conflict_id": None, "error": operation.last_error})
        except Exception as exc:
            db.rollback()
            operation.status = "failed"
            operation.last_error = str(exc)
            db.add(operation)
            db.commit()
            results.append({"idempotency_key": item.idempotency_key, "status": "failed", "entity_id": operation.entity_id, "version": None, "conflict_id": None, "error": operation.last_error})
    return {"results": results}


@router.get("/api/sync/status")
def sync_status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    operations = list(db.scalars(select(SyncOperation).where(SyncOperation.user_id == user.id)))
    conflicts = list(db.scalars(select(SyncConflict).join(SyncOperation, SyncOperation.id == SyncConflict.operation_id).where(SyncOperation.user_id == user.id, SyncConflict.status == "open")))
    completed = [operation.completed_at for operation in operations if operation.status == "synchronized" and operation.completed_at]
    return {
        "pending": len([operation for operation in operations if operation.status in ("accepted", "processing")]),
        "synchronized": len([operation for operation in operations if operation.status == "synchronized"]),
        "failed": len([operation for operation in operations if operation.status == "failed"]),
        "conflicts": len(conflicts),
        "last_successful_sync": max(completed) if completed else None,
    }


@router.get("/api/sync/history")
def sync_history(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    operations = list(db.scalars(select(SyncOperation).where(SyncOperation.user_id == user.id).order_by(SyncOperation.created_at.desc()).limit(100)))
    return [
        {
            "id": str(operation.id),
            "idempotency_key": operation.idempotency_key,
            "operation": operation.operation,
            "entity_id": str(operation.entity_id) if operation.entity_id else None,
            "status": operation.status,
            "attempt_count": operation.attempt_count,
            "last_error": operation.last_error,
            "created_at": operation.created_at,
            "completed_at": operation.completed_at,
        }
        for operation in operations
    ]


@router.get("/api/sync/conflicts")
def conflicts(db: Session = Depends(get_db), user: User = Depends(require_roles("administrator"))):
    rows = list(db.scalars(select(SyncConflict).order_by(SyncConflict.created_at.desc())))
    return [
        {
            "id": str(row.id),
            "inspection_id": str(row.inspection_id),
            "operation_id": str(row.operation_id),
            "local_payload": row.local_payload,
            "server_payload": row.server_payload,
            "status": row.status,
            "resolved_payload": row.resolved_payload,
            "resolution_note": row.resolution_note,
            "created_at": row.created_at,
            "resolved_at": row.resolved_at,
        }
        for row in rows
    ]


@router.post("/api/sync/conflicts/{conflict_id}/resolve")
def resolve_conflict(conflict_id: UUID, resolution: ConflictResolution, db: Session = Depends(get_db), user: User = Depends(require_roles("administrator"))):
    conflict = db.get(SyncConflict, conflict_id)
    if conflict is None:
        raise HTTPException(status_code=404, detail="Conflict not found")
    if conflict.status != "open":
        raise HTTPException(status_code=409, detail="Conflict already resolved")
    payload = conflict.server_payload if resolution.resolution == "accept_server" else (resolution.payload or conflict.local_payload)
    inspection = db.get(Inspection, conflict.inspection_id)
    inspection.title = payload.get("title", inspection.title)
    if "status" in payload:
        inspection.status = payload["status"]
    if "data" in payload:
        inspection.data = payload["data"]
    if "checklist" in payload:
        db.query(InspectionChecklistItem).filter(InspectionChecklistItem.inspection_id == inspection.id).delete(synchronize_session=False)
        for checklist in payload["checklist"]:
            db.add(InspectionChecklistItem(inspection_id=inspection.id, label=checklist["label"], status=checklist.get("status", "pending"), notes=checklist.get("notes"), sort_order=checklist.get("sort_order", 0)))
    inspection.version += 1
    conflict.status = "resolved"
    conflict.resolved_payload = payload
    conflict.resolved_by = user.id
    conflict.resolution_note = resolution.note
    conflict.resolved_at = datetime.now(timezone.utc)
    operation = db.get(SyncOperation, conflict.operation_id)
    operation.status = "synchronized"
    operation.completed_at = datetime.now(timezone.utc)
    operation.last_error = None
    db.add(AuditLog(user_id=user.id, action="sync.conflict_resolved", entity_type="inspection", entity_id=inspection.id, details={"conflict_id": str(conflict.id)}))
    db.commit()
    return {"id": str(conflict.id), "status": "resolved"}


@router.get("/api/admin/users", response_model=list[UserOut])
def users(db: Session = Depends(get_db), _: User = Depends(require_roles("administrator"))):
    return list(db.scalars(select(User).order_by(User.full_name)))


@router.post("/api/admin/users", response_model=UserOut, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db), actor: User = Depends(require_roles("administrator"))):
    if db.scalar(select(User).where(User.email == payload.email.lower())):
        raise HTTPException(status_code=409, detail="Email already exists")
    user = User(email=payload.email.lower(), full_name=payload.full_name, password_hash=hash_password(payload.password), role=payload.role)
    db.add(user)
    db.flush()
    db.add(AuditLog(user_id=actor.id, action="user.created", entity_type="user", entity_id=user.id, details={"role": user.role}))
    db.commit()
    db.refresh(user)
    return user


@router.post("/api/admin/assignments", status_code=201)
def assign(payload: dict, db: Session = Depends(get_db), actor: User = Depends(require_roles("administrator"))):
    site_id = UUID(str(payload["site_id"]))
    user_id = UUID(str(payload["user_id"]))
    existing = db.scalar(select(SiteAssignment).where(SiteAssignment.site_id == site_id, SiteAssignment.user_id == user_id))
    if existing:
        return {"id": str(existing.id), "site_id": str(site_id), "user_id": str(user_id)}
    assignment = SiteAssignment(site_id=site_id, user_id=user_id)
    db.add(assignment)
    db.flush()
    db.add(AuditLog(user_id=actor.id, action="site.assigned", entity_type="site", entity_id=site_id, details={"user_id": str(user_id)}))
    db.commit()
    db.refresh(assignment)
    return {"id": str(assignment.id), "site_id": str(site_id), "user_id": str(user_id)}


@router.patch("/api/admin/users/{user_id}", response_model=UserOut)
def update_admin_user(
    user_id: UUID,
    payload: dict,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles("administrator")),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if "full_name" in payload:
        user.full_name = str(payload["full_name"]).strip()
    if "role" in payload and payload["role"] in ("administrator", "inspector", "employee"):
        user.role = payload["role"]
    if "is_active" in payload:
        user.is_active = bool(payload["is_active"])
    db.add(AuditLog(
        user_id=actor.id,
        action="user.updated",
        entity_type="user",
        entity_id=user.id,
        details=payload,
    ))
    db.commit()
    db.refresh(user)
    return user


@router.delete("/api/admin/users/{user_id}", status_code=204)
def remove_admin_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles("administrator")),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == actor.id:
        raise HTTPException(status_code=409, detail="The active owner account cannot remove itself")
    db.delete(user)
    db.flush()
    db.add(AuditLog(
        user_id=actor.id,
        action="user.removed",
        entity_type="user",
        entity_id=user_id,
        details={"removed_email": user.email},
    ))
    db.commit()
    return None


@router.delete("/api/admin/assignments")
def remove_assignment(
    site_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles("administrator")),
):
    assignment = db.scalar(
        select(SiteAssignment).where(
            SiteAssignment.site_id == site_id,
            SiteAssignment.user_id == user_id,
        )
    )
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    db.delete(assignment)
    db.add(AuditLog(
        user_id=actor.id,
        action="site.assignment_removed",
        entity_type="site",
        entity_id=site_id,
        details={"user_id": str(user_id)},
    ))
    db.commit()
    return {"removed": True}


@router.get("/api/activity")
def activity(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = list(db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(100)))
    return [
        {
            "id": str(row.id),
            "action": row.action,
            "entity_type": row.entity_type,
            "entity_id": str(row.entity_id) if row.entity_id else None,
            "details": row.details,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.get("/api/reports/summary")
def report(status_filter: str | None = Query(default=None, alias="status"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = select(Inspection)
    if user.role in ("inspector", "employee"):
        statement = statement.where(Inspection.inspector_id == user.id)
    if status_filter:
        statement = statement.where(Inspection.status == status_filter)
    inspections = list(db.scalars(statement))
    from sqlalchemy import func
    status_counts = dict(db.execute(select(Inspection.status, func.count(Inspection.id)).group_by(Inspection.status)).all())
    return {
        "total_sites": db.scalar(select(func.count(Site.id))) or 0,
        "total_inspections": len(inspections),
        "status_counts": status_counts,
        "completed": len([item for item in inspections if item.status == "completed"]),
        "open_conflicts": db.scalar(select(func.count(SyncConflict.id)).where(SyncConflict.status == "open")) or 0,
        "generated_at": datetime.utcnow(),
    }
