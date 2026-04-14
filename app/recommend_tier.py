"""点评推荐度：五档文案与校验。"""

from typing import Literal

RECOMMEND_TIER_VALUES: tuple[str, ...] = ("夯", "顶级", "人上人", "NPC", "拉完了")
RecommendTier = Literal["夯", "顶级", "人上人", "NPC", "拉完了"]

DEFAULT_RECOMMEND_TIER: RecommendTier = "人上人"


def normalize_recommend_tier(raw: str | None) -> RecommendTier:
    s = (raw or "").strip()
    if s in RECOMMEND_TIER_VALUES:
        return s  # type: ignore[return-value]
    return DEFAULT_RECOMMEND_TIER
