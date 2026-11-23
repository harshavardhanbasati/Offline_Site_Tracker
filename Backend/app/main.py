from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.entities import AuditLog, Site, SiteAssignment, User
from app.routers.api import router


def seed() -> None:
    db = SessionLocal()
    try:
        admin = db.scalar(select(User).where(User.email == "admin@fieldsync.com"))
        if admin is None:
            admin = User(email="admin@fieldsync.com", full_name="Morgan Admin", password_hash=hash_password("password123"), role="administrator")
            inspector = User(email="inspector@fieldsync.com", full_name="Jordan Inspector", password_hash=hash_password("password123"), role="inspector")
            harsha = User(email="harsha@gmail.com", full_name="Harsha Vardhan", password_hash=hash_password("password123"), role="inspector")
            db.add_all([admin, inspector, harsha])
            db.flush()
        else:
            inspector = db.scalar(select(User).where(User.email == "inspector@fieldsync.com"))
            harsha = db.scalar(select(User).where(User.email == "harsha@gmail.com"))
            if inspector is None:
                inspector = User(email="inspector@fieldsync.com", full_name="Jordan Inspector", password_hash=hash_password("password123"), role="inspector")
                db.add(inspector)
            if harsha is None:
                harsha = User(email="harsha@gmail.com", full_name="Harsha Vardhan", password_hash=hash_password("password123"), role="inspector")
                db.add(harsha)
            db.flush()
        site_specs = [
            dict(name="Harbor Distribution Center", code="HDC-001", address="240 Harbor Way, Boston, MA", latitude=42.3601, longitude=-71.0589),
            dict(name="Northwind Substation", code="NST-014", address="88 Grid Avenue, Salem, MA", latitude=42.5195, longitude=-70.8967),
            dict(name="Riverside Pump Station", code="RPS-208", address="17 Riverside Drive, Cambridge, MA", latitude=42.3736, longitude=-71.1097),
        ]
        sites = []
        for spec in site_specs:
            site = db.scalar(select(Site).where(Site.code == spec["code"]))
            if site is None:
                site = Site(**spec)
                db.add(site)
                db.flush()
            sites.append(site)
        if inspector is not None and harsha is not None:
            for site in sites:
                for user in (inspector, harsha):
                    assignment = db.scalar(select(SiteAssignment).where(SiteAssignment.site_id == site.id, SiteAssignment.user_id == user.id))
                    if assignment is None:
                        db.add(SiteAssignment(site_id=site.id, user_id=user.id))
        db.add(AuditLog(user_id=admin.id, action="seed.development_data", entity_type="system", details={"notice": "Development seed data"}))
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    seed()
    yield


settings = get_settings()
app = FastAPI(title="FieldSync API", description="Offline-first field inspection management API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, (dict, list, str)) else str(exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.status_code, "message": detail, "path": str(request.url.path)}})


app.include_router(router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "fieldsync-api"}
