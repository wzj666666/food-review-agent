from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=4, max_length=128)


class UserLogin(BaseModel):
    username: str
    password: str


class UserPublic(BaseModel):
    id: int
    username: str
    display_name: str
    bio: str
    city: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=64)
    bio: str | None = Field(default=None, max_length=256)
    city: str | None = Field(default=None, max_length=32)


class ReviewCreate(BaseModel):
    restaurant_name: str = Field(min_length=1, max_length=128)
    dining_type: Literal["dine_in", "takeaway"]
    province: str = ""
    city: str = Field(min_length=1, max_length=32)
    district: str = Field(default="", max_length=32)
    taste_score: float = Field(ge=0, le=5)
    # 外卖可不传；后端用 (口味+性价比)/2 写入库，便于综合分 = 两项均值
    service_score: float | None = Field(default=None, ge=0, le=5)
    environment_score: float | None = Field(default=None, ge=0, le=5)
    value_score: float = Field(ge=0, le=5)
    avg_price: int = Field(ge=0, le=999999)
    dishes: list[str] = Field(default_factory=list)
    content: str = Field(min_length=1, max_length=500)
    images: list[str] = Field(default_factory=list, description="配图 URL 路径，最多 9 张")

    @field_validator("images")
    @classmethod
    def cap_images(cls, v: list[str]) -> list[str]:
        out = [x.strip() for x in v if x and str(x).strip()]
        return out[:9]

    @field_validator("dishes")
    @classmethod
    def trim_dishes(cls, v: list[str]) -> list[str]:
        out = [d.strip() for d in v if d and d.strip()]
        return out[:50]

    @model_validator(mode="after")
    def resolve_dining_scores(self):
        if self.dining_type == "takeaway":
            mid = (self.taste_score + self.value_score) / 2.0
            object.__setattr__(self, "service_score", mid)
            object.__setattr__(self, "environment_score", mid)
        elif self.service_score is None or self.environment_score is None:
            raise ValueError("堂食需填写服务与环境评分")
        return self


class ReviewOut(BaseModel):
    id: int
    user_id: int
    author_username: str
    restaurant_name: str
    dining_type: str
    province: str
    city: str
    district: str
    taste_score: float
    service_score: float
    environment_score: float
    value_score: float
    avg_price: int
    dishes: list[str]
    images: list[str] = Field(default_factory=list)
    content: str
    created_at: datetime
    overall_score: float

    class Config:
        from_attributes = True


class UploadedImagePath(BaseModel):
    path: str = Field(min_length=8, max_length=512)


class AIChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class AIChatRequest(BaseModel):
    messages: list[AIChatMessage]
