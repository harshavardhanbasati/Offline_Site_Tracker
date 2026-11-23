# FieldSync Deployment

## Development

```powershell
cd "C:\Application Development\UseCases\Offline_Inspection_App"
py -3.14 -m venv .venv
.venv\Scripts\python.exe -m pip install -r Backend\requirements.txt
cd Backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
cd "C:\Application Development\UseCases\Offline_Inspection_App\Frontend"
npm install
npm run dev
```

Development login accounts:

- `admin@fieldsync.com`
- `inspector@fieldsync.com`
- `harsha@gmail.com`
- Password: `password123`

## PostgreSQL and migrations

Set `DATABASE_URL` to a PostgreSQL URL, then run:

```powershell
cd Backend
..\.venv\Scripts\python.exe -m alembic upgrade head
```

Create a migration after model changes:

```powershell
..\.venv\Scripts\python.exe -m alembic revision --autogenerate -m "describe change"
```

## Docker

```powershell
docker compose up --build
```

Services:

- Frontend: `http://localhost:5173`
- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`
- PostgreSQL: port `5432`

## Production

1. Copy `.env.example` to `.env` and replace every secret.
2. Set an HTTPS frontend and API origin.
3. Restrict `CORS_ORIGINS` to the exact frontend origin.
4. Run migrations before starting the backend.
5. Deploy the frontend behind TLS and the backend behind a restricted reverse proxy.
6. Use a managed PostgreSQL service and persistent volume for database data.

```powershell
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

## Verification

```powershell
cd Backend
..\.venv\Scripts\python.exe -m pytest -q

cd ..\Frontend
npm test
npm run build
npm run test:e2e
```
