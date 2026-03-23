from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.categories import router as categories_router
from app.api.v1.expenses import router as expenses_router
from app.api.v1.groups import router as groups_router
from app.api.v1.members import router as members_router
from app.api.v1.notifications import router as notifications_router
from app.api.v1.settlements import router as settlements_router
from app.api.v1.users import router as users_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(groups_router)
api_router.include_router(members_router)
api_router.include_router(expenses_router)
api_router.include_router(settlements_router)
api_router.include_router(categories_router)
api_router.include_router(notifications_router)

from app.api.v1.group_currencies import router as group_currencies_router
api_router.include_router(group_currencies_router)

from app.api.v1.admin import router as admin_router
api_router.include_router(admin_router)

from app.api.v1.reports import router as reports_router
api_router.include_router(reports_router)

from app.api.v1.payment_methods import router as payment_methods_router
api_router.include_router(payment_methods_router)
