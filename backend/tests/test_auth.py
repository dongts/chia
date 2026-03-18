import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register", json={
        "email": "new@example.com", "password": "pass123", "display_name": "New User",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient, test_user):
    resp = await client.post("/api/v1/auth/register", json={
        "email": "test@example.com", "password": "pass123", "display_name": "Dup",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_login(client: AsyncClient, test_user):
    resp = await client.post("/api/v1/auth/login", json={
        "email": "test@example.com", "password": "testpass123",
    })
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient, test_user):
    resp = await client.post("/api/v1/auth/login", json={
        "email": "test@example.com", "password": "wrong",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_guest_auth(client: AsyncClient):
    resp = await client.post("/api/v1/auth/guest", json={
        "device_id": "device-123", "display_name": "Guest User",
    })
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_guest_auth_same_device(client: AsyncClient):
    resp1 = await client.post("/api/v1/auth/guest", json={"device_id": "dev-1", "display_name": "G"})
    resp2 = await client.post("/api/v1/auth/guest", json={"device_id": "dev-1", "display_name": "G"})
    assert resp1.status_code == 200
    assert resp2.status_code == 200


@pytest.mark.asyncio
async def test_get_me(client: AsyncClient, auth_headers):
    resp = await client.get("/api/v1/users/me", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == "test@example.com"


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient):
    reg = await client.post("/api/v1/auth/register", json={
        "email": "ref@example.com", "password": "pass123", "display_name": "Ref",
    })
    refresh = reg.json()["refresh_token"]
    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 200
    assert "access_token" in resp.json()
