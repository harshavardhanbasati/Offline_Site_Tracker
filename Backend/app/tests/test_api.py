from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def login(email: str = "inspector@fieldsync.com", password: str = "password123") -> str:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


def headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_login_and_protected_profile():
    token = login()
    response = client.get("/api/auth/me", headers=headers(token))
    assert response.status_code == 200
    assert response.json()["email"] == "inspector@fieldsync.com"
    assert response.json()["role"] == "inspector"


def test_assigned_sites_are_visible_to_inspector():
    token = login()
    response = client.get("/api/sites", headers=headers(token))
    assert response.status_code == 200
    assert len(response.json()) >= 3


def test_harsha_development_account_can_login():
    token = login("harsha@gmail.com")
    response = client.get("/api/auth/me", headers=headers(token))
    assert response.status_code == 200
    assert response.json()["email"] == "harsha@gmail.com"
    assert response.json()["role"] == "inspector"


def test_public_registration_creates_inspector():
    email = f"registered-{uuid4()}@example.com"
    response = client.post(
        "/api/auth/register",
        json={
            "full_name": "Registered Inspector",
            "email": email,
            "password": "password123",
            "role": "inspector",
        },
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    me = client.get("/api/auth/me", headers=headers(token))
    assert me.status_code == 200
    assert me.json()["email"] == email
    assert me.json()["role"] == "inspector"


def test_public_registration_creates_employee():
    email = f"employee-{uuid4()}@example.com"
    response = client.post(
        "/api/auth/register",
        json={
            "full_name": "Registered Employee",
            "email": email,
            "password": "password123",
            "role": "employee",
        },
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    me = client.get("/api/auth/me", headers=headers(token))
    assert me.status_code == 200
    assert me.json()["role"] == "employee"


def test_employee_cannot_create_inspection():
    email = f"employee-task-{uuid4()}@example.com"
    registration = client.post(
        "/api/auth/register",
        json={
            "full_name": "Task Employee",
            "email": email,
            "password": "password123",
            "role": "employee",
        },
    )
    assert registration.status_code == 200
    token = registration.json()["access_token"]
    inspector_token = login()
    sites = client.get("/api/sites", headers=headers(inspector_token)).json()
    created = client.post(
        "/api/inspections",
        headers=headers(token),
        json={
            "site_id": sites[0]["id"],
            "title": "Employee Cannot Create",
            "status": "draft",
            "data": {},
            "checklist": [],
        },
    )
    assert created.status_code == 403


def test_duplicate_sync_request_is_idempotent():
    token = login()
    sites = client.get("/api/sites", headers=headers(token)).json()
    operation = {
        "idempotency_key": "idempotency-test-create-001",
        "operation": "create_inspection",
        "payload": {
            "id": "2d52d4e1-c15a-4d4f-bdc8-ec8b5e228101",
            "site_id": sites[0]["id"],
            "title": "Idempotency Test Inspection",
            "status": "draft",
            "data": {"test": True},
            "checklist": [],
        },
    }
    first = client.post("/api/sync", headers=headers(token), json={"operations": [operation]})
    second = client.post("/api/sync", headers=headers(token), json={"operations": [operation]})
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["results"][0]["status"] == "synchronized"
    assert second.json()["results"][0]["status"] == "synchronized"


def test_version_conflict_is_detected():
    token = login()
    sites = client.get("/api/sites", headers=headers(token)).json()
    create = client.post(
        "/api/inspections",
        headers=headers(token),
        json={"site_id": sites[0]["id"], "title": "Conflict Test", "status": "draft", "data": {}, "checklist": []},
    )
    assert create.status_code == 201
    inspection = create.json()
    updated = client.patch(
        f"/api/inspections/{inspection['id']}",
        headers=headers(token),
        json={"expected_version": 1, "title": "Server Update"},
    )
    assert updated.status_code == 200
    conflict = client.post(
        "/api/sync",
        headers=headers(token),
        json={
            "operations": [
                {
                    "idempotency_key": f"conflict-test-{uuid4()}",
                    "operation": "update_inspection",
                    "entity_id": inspection["id"],
                    "payload": {
                        "id": inspection["id"],
                        "expected_version": 1,
                        "title": "Stale Local Update",
                        "status": "draft",
                        "data": {},
                        "checklist": [],
                    },
                }
            ]
        },
    )
    assert conflict.status_code == 200
    assert conflict.json()["results"][0]["status"] == "conflict"
