from fastapi import Depends

from app.config import settings
from app.core.exceptions import Forbidden
from app.core.security import get_current_user
from app.models import User


async def require_superadmin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.email not in settings.superadmin_emails:
        raise Forbidden("Superadmin access required")
    return current_user
