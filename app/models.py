from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(64), default="", server_default="")
    bio: Mapped[str] = mapped_column(String(256), default="", server_default="")
    city: Mapped[str] = mapped_column(String(32), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    reviews: Mapped[list["Review"]] = relationship("Review", back_populates="author")


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    restaurant_name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    dining_type: Mapped[str] = mapped_column(String(16), nullable=False)  # dine_in | takeaway
    province: Mapped[str] = mapped_column(String(32), default="", server_default="")
    city: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    district: Mapped[str] = mapped_column(String(32), default="", server_default="", index=True)
    taste_score: Mapped[float] = mapped_column(Float, nullable=False)
    service_score: Mapped[float] = mapped_column(Float, nullable=False)
    environment_score: Mapped[float] = mapped_column(Float, nullable=False)
    value_score: Mapped[float] = mapped_column(Float, nullable=False)
    avg_price: Mapped[int] = mapped_column(Integer, nullable=False)
    dishes_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array of strings
    images_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array of URL paths /uploads/uid/file
    videos_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array of video paths，最多 3 个
    attachments_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]"
    )  # JSON: [{"type":"image"|"video","path":"..."}] 穿插顺序
    recommend_tier: Mapped[str] = mapped_column(String(16), nullable=False, default="人上人", server_default="人上人")
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    content: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    author: Mapped["User"] = relationship("User", back_populates="reviews")
