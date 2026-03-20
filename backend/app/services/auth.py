from datetime import datetime, timedelta, timezone

import bcrypt
import httpx
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import User
from app.models.user import UserOAuth


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": user_id, "exp": expire, "type": "access"}, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    return jwt.encode({"sub": user_id, "exp": expire, "type": "refresh"}, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalars().first()


async def get_user_by_device_id(db: AsyncSession, device_id: str) -> User | None:
    result = await db.execute(select(User).where(User.device_id == device_id))
    return result.scalars().first()


# ── Google OAuth ─────────────────────────────────────────────────────────

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISS = ("accounts.google.com", "https://accounts.google.com")

_google_certs_cache: dict | None = None
_google_certs_expiry: float = 0


async def _get_google_certs() -> dict:
    """Fetch and cache Google's public JWK keys."""
    global _google_certs_cache, _google_certs_expiry
    import time

    if _google_certs_cache and time.time() < _google_certs_expiry:
        return _google_certs_cache

    async with httpx.AsyncClient() as client:
        resp = await client.get(GOOGLE_CERTS_URL)
        resp.raise_for_status()
        _google_certs_cache = resp.json()
        # Cache for 1 hour
        _google_certs_expiry = time.time() + 3600
        return _google_certs_cache


async def verify_google_id_token(credential: str) -> dict:
    """Verify a Google ID token and return the claims (email, sub, name, picture)."""
    from jose import jwk, jwt as jose_jwt
    from jose.utils import base64url_decode

    import json

    # Decode header to get kid
    header_segment = credential.split(".")[0]
    # Add padding
    header_segment += "=" * (4 - len(header_segment) % 4)
    header = json.loads(base64url_decode(header_segment))
    kid = header["kid"]

    # Get Google's public keys
    certs = await _get_google_certs()
    key_data = None
    for key in certs["keys"]:
        if key["kid"] == kid:
            key_data = key
            break

    if not key_data:
        raise ValueError("Google signing key not found")

    # Build RSA public key and verify
    public_key = jwk.construct(key_data, algorithm="RS256")
    claims = jose_jwt.decode(
        credential,
        public_key,
        algorithms=["RS256"],
        audience=settings.google_client_id,
        issuer=GOOGLE_ISS,
    )

    if not claims.get("email_verified"):
        raise ValueError("Google email not verified")

    return claims


async def get_or_create_google_user(db: AsyncSession, claims: dict) -> User:
    """Find or create a user from Google OAuth claims. Merges if email already exists."""
    google_sub = claims["sub"]
    email = claims["email"]
    name = claims.get("name", email.split("@")[0])
    picture = claims.get("picture")

    # 1. Check if this Google account is already linked
    result = await db.execute(
        select(UserOAuth).where(
            UserOAuth.provider == "google",
            UserOAuth.provider_user_id == google_sub,
        )
    )
    existing_oauth = result.scalars().first()

    if existing_oauth:
        # Already linked — fetch and return the user
        user_result = await db.execute(
            select(User).where(User.id == existing_oauth.user_id)
        )
        user = user_result.scalars().first()
        if user:
            # Update avatar if user doesn't have one
            if picture and not user.avatar_url:
                user.avatar_url = picture
                await db.commit()
            return user

    # 2. Check if a user with this email already exists (merge)
    user = await get_user_by_email(db, email)

    if not user:
        # 3. Create new user
        user = User(
            email=email,
            display_name=name,
            avatar_url=picture,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
    else:
        # Merge: mark as verified, update avatar if missing
        if not user.is_verified:
            user.is_verified = True
        if picture and not user.avatar_url:
            user.avatar_url = picture

    # Link Google OAuth account
    oauth_link = UserOAuth(
        user_id=user.id,
        provider="google",
        provider_user_id=google_sub,
    )
    db.add(oauth_link)
    await db.commit()
    await db.refresh(user)
    return user
