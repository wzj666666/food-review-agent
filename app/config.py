from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = Field(default="development", description="环境变量 APP_ENV，可选 development/staging/production")
    database_url: str | None = Field(
        default=None,
        description="保存到data/dianping.db",
    )
    secret_key: str = Field(
        ...,
        min_length=32,
        description="环境变量 SECRET_KEY，必填，建议 32 位以上随机字符串",
    )
    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        description="环境变量 CORS_ORIGINS，逗号分隔，如 https://app.example.com,https://admin.example.com",
    )
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7
    ai_base_url: str = Field(
        default="http://127.0.0.1:8020",
        description="环境变量 AI_BASE_URL，OpenAI 兼容 API 根地址（不含 /v1）",
    )
    ai_chat_path: str = "/v1/chat/completions"
    ai_model: str = Field(
        default="Qwen3.5-27B",
        description="环境变量 AI_MODEL",
    )
    # 与 vLLM --api-key 一致；OpenAI 兼容接口使用 Authorization: Bearer …
    ai_api_key: str | None = Field(default=None, description="环境变量 AI_API_KEY，需与 vLLM 启动时的 --api-key 相同")
    # 仅作用于 LangChain ChatOpenAI（参谋）；留空则直连，不影响高德等其它 httpx 请求
    ai_http_proxy: str | None = Field(
        default=None,
        description="环境变量 AI_HTTP_PROXY，例如 xxx（OpenRouter 等需翻墙时）",
    )
    # 注入 vLLM 的「全部点评」文本上限，避免上下文爆炸
    ai_reviews_context_max_chars: int = Field(default=120_000, description="环境变量 AI_REVIEWS_CONTEXT_MAX_CHARS")
    amap_key: str | None = Field(default=None, description="环境变量 AMAP_KEY，高德 Web 服务")
    debug_amap_agent: bool = Field(default=False, description="环境变量 DEBUG_AMAP_AGENT，打印 Agent messages")

    @field_validator("debug_amap_agent", mode="before")
    @classmethod
    def _parse_debug_amap_agent(cls, v: object) -> bool:
        if isinstance(v, bool):
            return v
        if v is None:
            return False
        s = str(v).strip().lower()
        return s in ("1", "true", "yes", "on", "y")

    @field_validator("app_env", mode="before")
    @classmethod
    def _normalize_app_env(cls, v: object) -> str:
        if v is None:
            return "development"
        s = str(v).strip().lower()
        allowed = {"development", "staging", "production"}
        if s not in allowed:
            raise ValueError("APP_ENV must be one of: development, staging, production")
        return s

    @field_validator("secret_key", mode="before")
    @classmethod
    def _validate_secret_key(cls, v: object) -> str:
        if v is None:
            raise ValueError("SECRET_KEY is required")
        s = str(v).strip()
        if len(s) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters")
        return s

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, v: object) -> str:
        if v is None:
            return "http://localhost:5173,http://127.0.0.1:5173"
        if isinstance(v, str):
            return v.strip()
        if isinstance(v, list):
            return ",".join(str(item).strip() for item in v if str(item).strip())
        raise ValueError("CORS_ORIGINS must be a comma-separated string")

    @property
    def cors_origins_list(self) -> list[str]:
        parts = [item.strip() for item in self.cors_origins.split(",")]
        return [item for item in parts if item]

    @model_validator(mode="after")
    def _validate_security(self) -> "Settings":
        if not self.cors_origins_list:
            raise ValueError("CORS_ORIGINS cannot be empty")
        if "*" in self.cors_origins_list:
            raise ValueError("CORS_ORIGINS cannot contain '*'")
        return self


settings = Settings()
