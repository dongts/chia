from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import get_current_user
from app.database import get_db
from app.models import User
from app.schemas.auth import (
    GoogleAuthRequest,
    GuestAuthRequest,
    LinkAccountRequest,
    LinkGoogleAccountRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UpgradeRequest,
)
from app.services.auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_or_create_google_user,
    get_user_by_device_id,
    get_user_by_email,
    hash_password,
    verify_google_id_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/config")
async def auth_config():
    """Public endpoint returning auth configuration (Google client ID, etc.)."""
    return {
        "google_client_id": settings.google_client_id or None,
    }


@router.post("/register", response_model=TokenResponse)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    if await get_user_by_email(db, data.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, data.email)
    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/guest", response_model=TokenResponse)
async def guest_auth(data: GuestAuthRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_device_id(db, data.device_id)
    if not user:
        user = User(device_id=data.device_id, display_name=data.display_name, is_verified=False)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/upgrade", response_model=TokenResponse)
async def upgrade_guest(
    data: UpgradeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.is_verified:
        raise HTTPException(status_code=400, detail="Already a verified user")
    if await get_user_by_email(db, data.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    current_user.email = data.email
    current_user.password_hash = hash_password(data.password)
    current_user.is_verified = True
    if data.display_name:
        current_user.display_name = data.display_name
    await db.commit()
    return TokenResponse(
        access_token=create_access_token(str(current_user.id)),
        refresh_token=create_refresh_token(str(current_user.id)),
    )


@router.post("/link-account", response_model=TokenResponse)
async def link_existing_account(
    data: LinkAccountRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Link guest account to an existing verified account via email/password.

    Merges all group memberships, expenses, and payment methods from the
    guest into the verified account, then deletes the guest.
    Returns tokens for the verified account.
    """
    if current_user.is_verified:
        raise HTTPException(status_code=400, detail="Already a verified user")

    target = await get_user_by_email(db, data.email)
    if not target:
        raise HTTPException(status_code=401, detail="Account not found")
    if not target.password_hash or not verify_password(data.password, target.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    from app.services.merge_users import merge_user_into
    await merge_user_into(db, current_user.id, target.id)

    return TokenResponse(
        access_token=create_access_token(str(target.id)),
        refresh_token=create_refresh_token(str(target.id)),
    )


@router.post("/link-google", response_model=TokenResponse)
async def link_google_account(
    data: LinkGoogleAccountRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Link guest account to an existing Google account.

    Verifies the Google credential, finds or creates the verified user,
    merges the guest into them, returns tokens for the verified account.
    """
    if current_user.is_verified:
        raise HTTPException(status_code=400, detail="Already a verified user")

    try:
        claims = await verify_google_id_token(data.credential)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Google credential")

    target = await get_or_create_google_user(db, claims)

    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot link to yourself")

    from app.services.merge_users import merge_user_into
    await merge_user_into(db, current_user.id, target.id)

    return TokenResponse(
        access_token=create_access_token(str(target.id)),
        refresh_token=create_refresh_token(str(target.id)),
    )


@router.post("/google", response_model=TokenResponse)
async def google_auth(data: GoogleAuthRequest, db: AsyncSession = Depends(get_db)):
    try:
        claims = await verify_google_id_token(data.credential)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Google credential")
    user = await get_or_create_google_user(db, claims)
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(data: RefreshRequest):
    try:
        payload = decode_token(data.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id = payload["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )
