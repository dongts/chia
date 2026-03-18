import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.groups import get_current_member
from app.core.exceptions import NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import Category, MemberRole, User
from app.schemas.category import CategoryCreate, CategoryRead

router = APIRouter(tags=["categories"])


@router.get("/categories", response_model=list[CategoryRead])
async def list_system_categories(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Category).where(Category.group_id.is_(None)))
    return result.scalars().all()


@router.get("/groups/{group_id}/categories", response_model=list[CategoryRead])
async def list_group_categories(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(Category).where(
            or_(Category.group_id == group_id, Category.group_id.is_(None))
        )
    )
    return result.scalars().all()


@router.post("/groups/{group_id}/categories", response_model=CategoryRead)
async def create_category(
    group_id: uuid.UUID,
    data: CategoryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    member = await get_current_member(db, group_id, current_user.id)
    require_role(member, MemberRole.owner, MemberRole.admin)
    category = Category(
        group_id=group_id,
        name=data.name,
        icon=data.icon,
        is_default=data.is_default,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.patch("/groups/{group_id}/categories/{category_id}", response_model=CategoryRead)
async def update_category(
    group_id: uuid.UUID,
    category_id: uuid.UUID,
    data: CategoryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    member = await get_current_member(db, group_id, current_user.id)
    require_role(member, MemberRole.owner, MemberRole.admin)
    result = await db.execute(
        select(Category).where(Category.id == category_id, Category.group_id == group_id)
    )
    category = result.scalars().first()
    if not category:
        raise NotFound("Category not found")
    category.name = data.name
    category.icon = data.icon
    category.is_default = data.is_default
    await db.commit()
    await db.refresh(category)
    return category


@router.delete("/groups/{group_id}/categories/{category_id}")
async def delete_category(
    group_id: uuid.UUID,
    category_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    member = await get_current_member(db, group_id, current_user.id)
    require_role(member, MemberRole.owner, MemberRole.admin)
    result = await db.execute(
        select(Category).where(Category.id == category_id, Category.group_id == group_id)
    )
    category = result.scalars().first()
    if not category:
        raise NotFound("Category not found")
    await db.delete(category)
    await db.commit()
    return {"detail": "Category deleted"}
