from pydantic import BaseModel, EmailStr


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GuestAuthRequest(BaseModel):
    device_id: str
    display_name: str = "Guest"


class UpgradeRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class LinkAccountRequest(BaseModel):
    email: EmailStr
    password: str


class LinkGoogleAccountRequest(BaseModel):
    credential: str  # Google ID token


class GoogleAuthRequest(BaseModel):
    credential: str  # Google ID token from Sign In With Google
