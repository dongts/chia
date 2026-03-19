from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://chia:chia@localhost:5432/chia"
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 365  # 1 year
    refresh_token_expire_days: int = 365  # 1 year
    superadmin_emails: list[str] = []
    upload_dir: str = "./uploads"
    max_upload_size: int = 10 * 1024 * 1024  # 10MB
    cors_origins: list[str] = ["http://localhost:5173"]
    use_connection_pooler: bool = False
    port: int = 8000
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.2

    model_config = {"env_prefix": "CHIA_"}


settings = Settings()
