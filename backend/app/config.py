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
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = ""
    r2_public_url: str = ""
    cors_origins: list[str] = ["http://localhost:5173"]
    use_connection_pooler: bool = False
    port: int = 8000
    google_client_id: str = ""
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.2
    llm_model: str = "groq/llama-3.1-8b-instant"
    llm_api_key: str | None = None
    llm_default_parsing_level: str = "basic"

    model_config = {"env_prefix": "CHIA_"}


settings = Settings()
