"""
AOTG deploy-fix verification tests.

Validates the newly added companion FastAPI backend used by the Emergent
deploy pipeline: build env read, uvicorn boot on 0.0.0.0:8001, /api health
check, and MongoDB connectivity (migrate step).
"""
import os
from pathlib import Path

import pytest


# ── Module: environment / configuration ─────────────────────────────────────
class TestBackendEnvironment:
    """Confirm backend/.env is present and drives config (no hardcoded conn)."""

    def test_env_file_exists(self):
        env_path = Path("/app/backend/.env")
        assert env_path.exists(), "backend/.env missing — deploy build will fail"

    def test_env_has_required_keys(self):
        content = Path("/app/backend/.env").read_text()
        assert "MONGO_URL" in content
        assert "DB_NAME" in content

    def test_server_reads_env_not_hardcoded(self):
        src = Path("/app/backend/server.py").read_text()
        # No hardcoded mongo URI in server.py
        assert "mongodb://" not in src, "MONGO_URL must come from env, not code"
        assert 'os.environ["MONGO_URL"]' in src or "os.environ.get(\"MONGO_URL\"" in src
        assert 'os.environ["DB_NAME"]' in src or "os.environ.get(\"DB_NAME\"" in src


# ── Module: root & health endpoints (deploy HEALTH_CHECK target) ────────────
class TestRootAndHealth:

    def test_root_returns_ok(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "ok"
        assert "message" in data

    def test_health_reports_db_connected(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/health")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "healthy"
        assert data.get("database") == "connected", (
            f"MongoDB not reachable from backend: {data}"
        )


# ── Module: /api/status CRUD (MONGODB_MIGRATE read/write verification) ──────
class TestStatusCheckPersistence:

    def test_create_status_persists_and_returns_id(self, api_client, base_url):
        payload = {"client_name": "TEST_deploy_verifier"}
        r = api_client.post(f"{base_url}/api/status", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["client_name"] == payload["client_name"]
        assert isinstance(data.get("id"), str) and len(data["id"]) > 0
        assert isinstance(data.get("timestamp"), str) and len(data["timestamp"]) > 0
        # stash for follow-up read test
        pytest._aotg_last_id = data["id"]  # type: ignore[attr-defined]
        pytest._aotg_last_name = data["client_name"]  # type: ignore[attr-defined]

    def test_list_status_returns_created_record(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/status")
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 1

        expected_id = getattr(pytest, "_aotg_last_id", None)
        expected_name = getattr(pytest, "_aotg_last_name", None)
        if expected_id:
            match = next((i for i in items if i.get("id") == expected_id), None)
            assert match is not None, (
                f"Previously-created record {expected_id} not returned by GET /api/status"
            )
            assert match["client_name"] == expected_name
            # confirm mongo ObjectId is not leaking through
            assert "_id" not in match

    def test_no_mongo_objectid_leaks(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/status")
        assert r.status_code == 200
        for item in r.json():
            assert "_id" not in item, "Mongo _id must not appear in API response"


# ── Module: input validation ────────────────────────────────────────────────
class TestValidation:

    def test_status_rejects_missing_client_name(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/status", json={})
        assert r.status_code == 422
