from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str | None = Field(
        default=None,
        description="保存到data/dianping.db",
    )
    secret_key: str = "change-me-in-production-use-long-random-string"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7
    ai_base_url: str = "http://127.0.0.1:8020"
    ai_chat_path: str = "/v1/chat/completions"
    ai_model: str = "Qwen3.5-27B"
    # 与 vLLM --api-key 一致；OpenAI 兼容接口使用 Authorization: Bearer …
    ai_api_key: str | None = Field(default=None, description="环境变量 AI_API_KEY，需与 vLLM 启动时的 --api-key 相同")
    # 注入 vLLM 的「全部点评」文本上限，避免上下文爆炸
    ai_reviews_context_max_chars: int = Field(default=120_000, description="环境变量 AI_REVIEWS_CONTEXT_MAX_CHARS")


settings = Settings()
