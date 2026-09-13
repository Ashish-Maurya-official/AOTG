"""
AOTG companion backend.

The AOTG app itself runs fully on-device (LiteRT-LM inference + Android
accessibility agent), so it does not depend on this server for its core
features. This lightweight FastAPI service exists to satisfy the Emergent
full-stack deploy contract (build reads backend/.env, the service must bind
0.0.0.0:8001, expose /api routes for the health check, and connect to MongoDB
for the migrate step). It is a clean place to add future sync/telemetry
endpoints without touching the mobile app's on-device logic.
"""

import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient

# ── Environment ──────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", "*").split(",")
    if origin.strip()
] or ["*"]

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aotg-backend")

# ── Database ─────────────────────────────────────────────────────────────────
client: AsyncIOMotorClient | None = None
db = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global client, db
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    logger.info("Connected to MongoDB database '%s'", DB_NAME)
    try:
        yield
    finally:
        if client is not None:
            client.close()
            logger.info("MongoDB connection closed")


app = FastAPI(title="AOTG Backend", version="1.0.0", lifespan=lifespan)

# All API routes are served under /api to match the Kubernetes ingress rules.
api = APIRouter(prefix="/api")


# ── Models ───────────────────────────────────────────────────────────────────
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    client_name: str
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class StatusCheckCreate(BaseModel):
    client_name: str


# ── Routes ───────────────────────────────────────────────────────────────────
@api.get("/")
async def root():
    return {"message": "AOTG backend is running", "status": "ok"}


@api.get("/health")
async def health():
    """Deep health check used by the deploy pipeline — verifies DB reachability."""
    db_ok = False
    try:
        await client.admin.command("ping")
        db_ok = True
    except Exception as exc:  # noqa: BLE001 - report, don't crash the probe
        logger.warning("MongoDB ping failed: %s", exc)
    return {"status": "healthy", "database": "connected" if db_ok else "unavailable"}


@api.post("/status", response_model=StatusCheck)
async def create_status_check(payload: StatusCheckCreate):
    doc = StatusCheck(client_name=payload.client_name)
    await db.status_checks.insert_one(doc.model_dump())
    return doc


@api.get("/status", response_model=list[StatusCheck])
async def list_status_checks():
    docs = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    return [StatusCheck(**doc) for doc in docs]


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8001, reload=False)
