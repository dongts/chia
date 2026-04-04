from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.system_config import SystemConfig

CONFIG_REGISTRY: dict[str, dict] = {
    "llm.default_model": {
        "type": "string",
        "default": "gemini/gemma-4-31b-it",
        "label": "Default LLM Model",
        "description": "LiteLLM model identifier for expense parsing",
    },
    "llm.default_parsing_level": {
        "type": "string",
        "default": "basic",
        "label": "Default Parsing Level",
        "description": "basic, smart, or full",
    },
}


async def get_config(db: AsyncSession, key: str) -> str:
    if key not in CONFIG_REGISTRY:
        raise KeyError(f"Unknown config key: {key}")
    result = await db.execute(
        select(SystemConfig.value).where(SystemConfig.key == key)
    )
    value = result.scalar()
    return value if value is not None else CONFIG_REGISTRY[key]["default"]


async def set_config(db: AsyncSession, key: str, value: str) -> None:
    if key not in CONFIG_REGISTRY:
        raise KeyError(f"Unknown config key: {key}")
    result = await db.execute(
        select(SystemConfig).where(SystemConfig.key == key)
    )
    existing = result.scalar()
    if existing:
        existing.value = value
    else:
        db.add(SystemConfig(key=key, value=value))
    await db.commit()


async def get_all_config(db: AsyncSession) -> list[dict]:
    result = await db.execute(select(SystemConfig))
    db_values = {row.key: row.value for row in result.scalars().all()}

    configs = []
    for key, meta in CONFIG_REGISTRY.items():
        configs.append({
            "key": key,
            "value": db_values.get(key, meta["default"]),
            "type": meta["type"],
            "default": meta["default"],
            "label": meta["label"],
            "description": meta["description"],
        })
    return configs
