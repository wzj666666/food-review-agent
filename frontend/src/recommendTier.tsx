/** 与后端 `RecommendTier` 一致 */
export const RECOMMEND_TIERS = ["夯", "顶级", "人上人", "NPC", "拉完了"] as const;
export type RecommendTier = (typeof RECOMMEND_TIERS)[number];

const TIER_CLASS: Record<RecommendTier, string> = {
  夯: "rec-tier rec-tier--hang",
  顶级: "rec-tier rec-tier--top",
  人上人: "rec-tier rec-tier--boss",
  NPC: "rec-tier rec-tier--npc",
  拉完了: "rec-tier rec-tier--done",
};

export function isRecommendTier(s: string): s is RecommendTier {
  return (RECOMMEND_TIERS as readonly string[]).includes(s);
}

/** 列表/卡片上展示推荐度色块 */
export function RecommendTierBadge({ tier }: { tier?: string | null }) {
  const raw = (tier ?? "").trim();
  const label = isRecommendTier(raw) ? raw : "人上人";
  const cls = isRecommendTier(raw) ? TIER_CLASS[raw] : TIER_CLASS["人上人"];
  return (
    <span className={cls} title="推荐度">
      {label}
    </span>
  );
}
