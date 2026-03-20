"""HTTP client for Chia API."""

import os

import httpx

BASE_URL = os.environ.get("CHIA_API_URL", "http://localhost:8000").rstrip("/")


class ChiaClient:
    """Authenticated HTTP client for the Chia expense splitter API.

    Each instance holds a single user's token. Create one per session via login().
    """

    def __init__(self, token: str):
        self._token = token
        self._http = httpx.AsyncClient(base_url=BASE_URL, timeout=30)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"}

    async def get(self, path: str, params: dict | None = None) -> dict | list:
        resp = await self._http.get(path, headers=self._headers(), params=params)
        resp.raise_for_status()
        return resp.json()

    async def post(self, path: str, json: dict | None = None) -> dict | list:
        resp = await self._http.post(path, headers=self._headers(), json=json)
        resp.raise_for_status()
        return resp.json()

    async def patch(self, path: str, json: dict | None = None) -> dict | list:
        resp = await self._http.patch(path, headers=self._headers(), json=json)
        resp.raise_for_status()
        return resp.json()

    async def delete(self, path: str) -> dict | None:
        resp = await self._http.delete(path, headers=self._headers())
        resp.raise_for_status()
        if resp.status_code == 204:
            return None
        return resp.json()

    async def close(self) -> None:
        await self._http.aclose()


async def login(email: str, password: str) -> ChiaClient:
    """Login to Chia API and return an authenticated client."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as http:
        resp = await http.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
        )
        resp.raise_for_status()
        token = resp.json()["access_token"]
    return ChiaClient(token=token)
