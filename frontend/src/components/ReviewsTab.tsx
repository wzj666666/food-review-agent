import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RegionProvince, Review, SortKey } from "../api";
import { fetchRegions, fetchReviews } from "../api";
import { formatDateTimeBeijing } from "../datetime";
import { RecommendTierBadge } from "../recommendTier";
import { ReviewEditorSheet } from "./ReviewEditorSheet";
import { ReviewImageGallery } from "./ReviewImageGallery";

function diningLabel(t: string) {
  return t === "takeaway" ? "外卖" : "堂食";
}

function ExpandableReviewContent({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const [needsToggle, setNeedsToggle] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (expanded) {
      setNeedsToggle(true);
      return;
    }
    setNeedsToggle(el.scrollHeight > el.clientHeight + 2);
  }, [text, expanded]);

  return (
    <>
      <p
        ref={ref}
        style={{
          margin: "10px 0 0",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          ...(expanded
            ? {}
            : {
                overflow: "hidden",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical" as const,
                WebkitLineClamp: 4,
              }),
        }}
      >
        {text}
      </p>
      {needsToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: 6,
            padding: 0,
            border: "none",
            background: "none",
            color: "var(--accent)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {expanded ? "收起" : "展开全文"}
        </button>
      )}
    </>
  );
}

export function ReviewsTab() {
  const [regions, setRegions] = useState<RegionProvince[]>([]);
  const [list, setList] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<SortKey>("time_desc");

  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 280);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchReviews({
        q: debouncedQ,
        sort,
      });
      setList(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  // 从后台回到浏览器、或从其他标签页切回时拉一次列表，避免长期停在「点评」却看到旧数据
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  useEffect(() => {
    void fetchRegions()
      .then(setRegions)
      .catch(() => setRegions([]));
  }, []);

  return (
    <div style={{ padding: "16px 16px 8px" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.2 }}>吃点好的</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>记录每一次小满足</div>
        </div>
        <button type="button" className="btn-fab" aria-label="添加点评" onClick={() => setSheetOpen(true)}>
          +
        </button>
      </header>

      <div className="card" style={{ padding: 12, marginTop: 14 }}>
        <input
          className="input"
          placeholder="搜餐厅名、推荐菜…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <label className="label">排序</label>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="time_desc">时间 · 最新在前</option>
          <option value="time_asc">时间 · 最早在前</option>
          <option value="score_desc">评分 · 从高到低</option>
          <option value="score_asc">评分 · 从低到高</option>
        </select>
      </div>

      {err && (
        <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }} onClick={() => void load()}>
          {err}（点击重试）
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {loading && <div style={{ color: "var(--muted)", textAlign: "center", padding: 24 }}>加载中…</div>}
        {!loading && list.length === 0 && (
          <div className="card" style={{ padding: 22, textAlign: "center", color: "var(--muted)" }}>
            还没有点评，点右上角「+」写下第一家吧。
          </div>
        )}
        {!loading &&
          list.map((r) => (
            <article key={r.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 10,
                    alignItems: "start",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.3, wordBreak: "break-word" }}>
                    {r.restaurant_name}
                  </div>
                  <div style={{ flexShrink: 0, paddingTop: 1 }}>
                    <RecommendTierBadge tier={r.recommend_tier} />
                  </div>
                </div>
                <div className="score-badge">{r.overall_score.toFixed(1)}</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
                <span className="chip">{diningLabel(r.dining_type)}</span>
                <span className="chip">
                  {r.city}
                  {r.district ? ` · ${r.district}` : ""}
                </span>
                <span className="chip">人均 ¥{r.avg_price}</span>
                <span className="chip">@{r.author_username}</span>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
                {r.dining_type === "takeaway" ? (
                  <>
                    口味 {r.taste_score} · 性价比 {r.value_score}
                    <span style={{ marginLeft: 6, opacity: 0.85 }}>（外卖）</span>
                  </>
                ) : (
                  <>
                    口味 {r.taste_score} · 服务 {r.service_score} · 环境 {r.environment_score} · 性价比 {r.value_score}
                  </>
                )}
              </div>
              {r.dishes.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  <span style={{ color: "var(--muted)" }}>推荐菜：</span>
                  {r.dishes.join("、")}
                </div>
              )}
              <ReviewImageGallery paths={r.images ?? []} />
              <ExpandableReviewContent text={r.content} />
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>{formatDateTimeBeijing(r.created_at)}</div>
            </article>
          ))}
      </div>

      {sheetOpen && (
        <ReviewEditorSheet
          regions={regions}
          initial={null}
          onClose={() => setSheetOpen(false)}
          onSuccess={async () => {
            setSheetOpen(false);
            await load();
          }}
        />
      )}
    </div>
  );
}
