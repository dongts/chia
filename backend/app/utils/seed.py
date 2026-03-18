from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category

SYSTEM_CATEGORIES = [
    ("General", "📦", True),
    ("Food & Drinks", "🍔", False),
    ("Transport", "🚗", False),
    ("Accommodation", "🏠", False),
    ("Shopping", "🛍️", False),
    ("Entertainment", "🎬", False),
    ("Health", "💊", False),
    ("Utilities", "💡", False),
]


async def seed_categories(db: AsyncSession):
    existing = await db.execute(select(Category).where(Category.group_id.is_(None)))
    if existing.scalars().first():
        return
    for name, icon, is_default in SYSTEM_CATEGORIES:
        db.add(Category(name=name, icon=icon, is_default=is_default))
    await db.commit()
