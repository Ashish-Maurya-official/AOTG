"""Shared pytest fixtures for AOTG backend tests."""
import os
import pytest
import requests

# Bare RN repo has no /app/frontend/.env with EXPO_BACKEND_URL. The deploy
# pipeline hits the backend internally on 0.0.0.0:8001 (that's the port the
# supervisor-managed uvicorn binds to and what HEALTH_CHECK targets). Allow
# override via env for future ingress setups.
BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")


@pytest.fixture(scope="session")
def base_url() -> str:
    return BASE_URL


@pytest.fixture
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session
