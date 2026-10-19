"""Financial API routers; persistence uses native D1 atomic batches."""
from fastapi import APIRouter
from chia_api.finance_expenses import router as expenses_router
from chia_api.finance_funds import router as funds_router
from chia_api.finance_settlements import router as settlements_router

router = APIRouter()
router.include_router(expenses_router)
router.include_router(funds_router)
router.include_router(settlements_router)
