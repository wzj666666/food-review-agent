from pydantic import Field, field_validator
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


settings = Settings()
