from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.config import settings
from app.database import async_session
from app.utils.seed import seed_categories


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        async with async_session() as db:
            await seed_categories(db)
    except Exception:
        pass  # Don't block startup if seeding fails (e.g., tables not yet migrated)
    yield


app = FastAPI(title="Chia", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(api_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
