from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Login(ORM):
    email: EmailStr
    password: str = Field(min_length=6)


class Register(ORM):
    full_name: str = Field(min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8)
    role: Literal["inspector", "employee"]


class Refresh(ORM):
    refresh_token: str | None = None


class Tokens(ORM):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(ORM):
    id: UUID
    email: str
    full_name: str
    role: Literal["administrator", "inspector", "employee"]
    is_active: bool
    created_at: datetime


class UserCreate(ORM):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=8)
    role: Literal["administrator", "inspector", "employee"]


class SiteCreate(ORM):
    name: str = Field(min_length=2, max_length=255)
    code: str = Field(min_length=2, max_length=64)
    address: str = Field(min_length=2)
    latitude: float | None = None
    longitude: float | None = None
    status: Literal["active", "inactive", "planned"] = "active"


class SiteUpdate(ORM):
    name: str | None = None
    code: str | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    status: Literal["active", "inactive", "planned"] | None = None


class SiteOut(ORM):
    id: UUID
    name: str
    code: str
    address: str
    latitude: float | None
    longitude: float | None
    status: str
    version: int
    created_at: datetime
    updated_at: datetime


class ChecklistPayload(ORM):
    id: UUID | None = None
    label: str
    status: Literal["pending", "passed", "failed", "not_applicable"] = "pending"
    notes: str | None = None
    sort_order: int = 0


class InspectionCreate(ORM):
    id: UUID | None = None
    site_id: UUID
    title: str = Field(min_length=2)
    status: Literal["draft", "in_progress", "completed"] = "draft"
    data: dict = Field(default_factory=dict)
    checklist: list[ChecklistPayload] = Field(default_factory=list)


class InspectionUpdate(ORM):
    expected_version: int = Field(ge=1)
    title: str | None = None
    status: Literal["draft", "in_progress", "completed"] | None = None
    data: dict | None = None
    checklist: list[ChecklistPayload] | None = None


class InspectionOut(ORM):
    id: UUID
    site_id: UUID
    inspector_id: UUID
    title: str
    status: str
    data: dict
    version: int
    submitted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    checklist: list[dict] = Field(default_factory=list)


class SyncOperationIn(ORM):
    idempotency_key: str = Field(min_length=8, max_length=128)
    operation: Literal["create_inspection", "update_inspection"]
    entity_id: UUID | None = None
    payload: dict


class SyncBatch(ORM):
    operations: list[SyncOperationIn] = Field(min_length=1, max_length=100)


class ConflictResolution(ORM):
    resolution: Literal["accept_local", "accept_server"]
    payload: dict | None = None
    note: str | None = None
