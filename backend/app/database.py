from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import settings

# Use NullPool for serverless (Vercel) — no persistent connection pool
# Disable prepared statement cache for Supabase pooler compatibility
engine = create_async_engine(
    settings.database_url,
    poolclass=NullPool if settings.serverless else None,
    connect_args={
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
    } if settings.use_connection_pooler else {},
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        yield session
