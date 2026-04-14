import { useCallback, useEffect, useState } from "react";
import type { RegionProvince, Review, UserPublic } from "../api";
import { deleteReview, fetchMyReviews, fetchRegions, fetchStats, updateMe } from "../api";
import { RecommendTierBadge } from "../recommendTier";
import { ReviewEditorSheet } from "./ReviewEditorSheet";
import { ReviewImageGallery } from "./ReviewImageGallery";

type Props = {
  user: UserPublic;
  onUserUpdated: (u: UserPublic) => void;
  onLogout: () => void;
};

export function ProfileTab({ user, onUserUpdated, onLogout }: Props) {
  const [stats, setStats] = useState<{ review_count: number; restaurant_count: number; restaurants: string[] } | null>(
    null,
  );
  const [mine, setMine] = useState<Review[]>([]);
  const [regions, setRegions] = useState<RegionProvince[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editReview, setEditReview] = useState<Review | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([fetchStats(), fetchMyReviews()]);
      setStats(s);
      setMine(r);
    } catch {
      setStats(null);
      setMine([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchRegions()
      .then(setRegions)
      .catch(() => setRegions([]));
  }, []);

  const joined = new Date(user.created_at);
  const joinedText = Number.isNaN(joined.getTime())
    ? user.created_at
    : `${joined.getFullYear()}-${String(joined.getMonth() + 1).padStart(2, "0")}-${String(joined.getDate()).padStart(2, "0")}`;

  const handleDelete = async (r: Review) => {
    if (!window.confirm(`确定删除「${r.restaurant_name}」这条点评？`)) return;
    try {
      await deleteReview(r.id);
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <div style={{ padding: "16px 16px 8px" }}>
      <header>
        <div style={{ fontSize: 22, fontWeight: 800 }}>我的</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>你的干饭档案</div>
      </header>

      <div className="card" style={{ padding: 16, marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            className="avatar-warm"
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              fontSize: 22,
            }}
            aria-hidden
          >
            {(user.display_name || user.username).slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.display_name || user.username}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>@{user.username}</div>
          </div>
          <button type="button" className="btn-ghost" style={{ width: "auto" }} onClick={() => setEditOpen(true)}>
            编辑
          </button>
        </div>

        {user.bio && (
          <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.55, color: "var(--text)" }}>{user.bio}</div>
        )}
        {user.city && (
          <div style={{ marginTop: 8 }} className="chip">
            常居：{user.city}
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>加入时间：{joinedText}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12 }}>
        <StatCard label="我的点评" value={loading ? "…" : String(stats?.review_count ?? 0)} />
        <StatCard label="餐馆数" value={loading ? "…" : String(stats?.restaurant_count ?? 0)} />
        <StatCard label="账号状态" value="正常" />
      </div>

      <div style={{ marginTop: 16, fontWeight: 800 }}>我去过的店</div>

      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {mine.length === 0 && !loading && (
          <div className="card" style={{ padding: 16, color: "var(--muted)" }}>
            暂无个人点评记录。
          </div>
        )}
        {mine.map((r) => (
          <div key={r.id} className="card" style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 10,
                    alignItems: "start",
                  }}
                >
                  <div style={{ fontWeight: 700, lineHeight: 1.3, wordBreak: "break-word" }}>{r.restaurant_name}</div>
                  <div style={{ flexShrink: 0, paddingTop: 1 }}>
                    <RecommendTierBadge tier={r.recommend_tier} />
                  </div>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                  {r.city}
                  {r.district ? ` · ${r.district}` : ""} · 综合 {r.overall_score.toFixed(1)}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ width: "auto", padding: "6px 12px", fontSize: 12 }}
                  onClick={() => setEditReview(r)}
                >
                  修改
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{
                    width: "auto",
                    padding: "6px 12px",
                    fontSize: 12,
                    borderColor: "rgba(180, 35, 24, 0.35)",
                    color: "var(--danger)",
                  }}
                  onClick={() => void handleDelete(r)}
                >
                  删除
                </button>
              </div>
            </div>
            {r.dishes.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 13 }}>推荐菜：{r.dishes.join("、")}</div>
            )}
            <ReviewImageGallery paths={r.images ?? []} />
            {r.content && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  color: "var(--text)",
                  lineHeight: 1.45,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical" as const,
                }}
              >
                {r.content}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn-ghost"
        style={{ width: "100%", marginTop: 16, borderColor: "rgba(248,113,113,0.35)" }}
        onClick={onLogout}
      >
        退出登录
      </button>

      {editOpen && (
        <EditProfileModal
          user={user}
          onClose={() => setEditOpen(false)}
          onSaved={(u) => {
            onUserUpdated(u);
            setEditOpen(false);
          }}
        />
      )}

      {editReview && (
        <ReviewEditorSheet
          regions={regions}
          initial={editReview}
          onClose={() => setEditReview(null)}
          onSuccess={async () => {
            setEditReview(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: 12, textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

function EditProfileModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserPublic;
  onClose: () => void;
  onSaved: (u: UserPublic) => void;
}) {
  const [displayName, setDisplayName] = useState(user.display_name || user.username);
  const [bio, setBio] = useState(user.bio || "");
  const [city, setCity] = useState(user.city || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const u = await updateMe({
        display_name: displayName.trim() || user.username,
        bio: bio.trim(),
        city: city.trim(),
      });
      onSaved(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="sheet-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>编辑资料</div>
          <button type="button" className="btn-ghost" style={{ width: "auto", padding: "8px 12px" }} onClick={onClose}>
            关闭
          </button>
        </div>
        {error && <div style={{ color: "var(--danger)", marginBottom: 10, fontSize: 13 }}>{error}</div>}
        <label className="label">昵称</label>
        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <label className="label" style={{ marginTop: 12 }}>
          个人简介
        </label>
        <textarea className="input" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} style={{ resize: "vertical" }} />
        <label className="label" style={{ marginTop: 12 }}>
          常居城市（手填）
        </label>
        <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="如：杭州" />
        <button type="button" className="btn-primary" style={{ marginTop: 14 }} disabled={saving} onClick={() => void save()}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}
