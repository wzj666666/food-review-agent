import { useEffect, useRef, useState } from "react";
import type { AttachmentItem, RegionProvince, Review, ReviewPayload, ReviewPoiSuggestion } from "../api";
import {
  createReview,
  deleteUploadedImage,
  fetchReviewLocationSuggestions,
  updateReview,
  uploadReviewImage,
  uploadReviewVideo,
  mergeReviewMedia,
} from "../api";
import { RECOMMEND_TIERS, type RecommendTier } from "../recommendTier";
import { ReviewMediaGallery } from "./ReviewMediaGallery";

/** 新建时的默认地点（与 app/data/regions.json 一致） */
export const DEFAULT_REVIEW_LOCATION = {
  province: "北京市",
  city: "北京市",
  district: "朝阳区",
} as const;

type Props = {
  regions: RegionProvince[];
  /** null 表示新建 */
  initial: Review | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
};

export function ReviewEditorSheet({ regions, initial, onClose, onSuccess }: Props) {
  const isEdit = initial != null;
  const [restaurantName, setRestaurantName] = useState("");
  const [diningType, setDiningType] = useState<"dine_in" | "takeaway">("dine_in");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [taste, setTaste] = useState(4);
  const [service, setService] = useState(4);
  const [env, setEnv] = useState(4);
  const [value, setValue] = useState(4);
  const [avgPrice, setAvgPrice] = useState<number | "">("");
  const [dishes, setDishes] = useState<string[]>([""]);
  const [content, setContent] = useState("");
  const [recommendTier, setRecommendTier] = useState<RecommendTier>("人上人");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [imgBusy, setImgBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [locModal, setLocModal] = useState<{
    suggestions: ReviewPoiSuggestion[];
    /** 当前展示第几条（0..2，对应高德返回顺序的前 3 条） */
    index: number;
    basePayload: ReviewPayload;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setRestaurantName(initial.restaurant_name);
      setDiningType(initial.dining_type === "takeaway" ? "takeaway" : "dine_in");
      setProvince(initial.province || "");
      setCity(initial.city);
      setDistrict(initial.district || "");
      setTaste(initial.taste_score);
      setService(initial.service_score);
      setEnv(initial.environment_score);
      setValue(initial.value_score);
      setAvgPrice(initial.avg_price);
      setDishes(initial.dishes.length > 0 ? [...initial.dishes] : [""]);
      setContent(initial.content);
      setRecommendTier(
        RECOMMEND_TIERS.includes(initial.recommend_tier as RecommendTier)
          ? (initial.recommend_tier as RecommendTier)
          : "人上人",
      );
      setAttachments(mergeReviewMedia(initial));
    } else {
      setRestaurantName("");
      setDiningType("dine_in");
      setProvince(DEFAULT_REVIEW_LOCATION.province);
      setCity(DEFAULT_REVIEW_LOCATION.city);
      setDistrict(DEFAULT_REVIEW_LOCATION.district);
      setTaste(4);
      setService(4);
      setEnv(4);
      setValue(4);
      setAvgPrice("");
      setDishes([""]);
      setContent("");
      setRecommendTier("人上人");
      setAttachments([]);
    }
    setError(null);
  }, [initial]);

  const provinces = regions.map((p) => p.name);
  const cities =
    regions.find((p) => p.name === province)?.cities.map((c) => c.name) ??
    ([] as string[]);
  const districts =
    regions.find((p) => p.name === province)?.cities.find((c) => c.name === city)?.districts ?? [];

  const imgCount = attachments.filter((a) => a.type === "image").length;
  const vidCount = attachments.filter((a) => a.type === "video").length;

  const addDishRow = () => setDishes((d) => [...d, ""]);

  const handlePickImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    // 必须先拷贝 File 列表再清空 value：FileList 与 input 绑定，清空后 length 会变为 0，导致永远不发起上传
    const arr = input.files && input.files.length > 0 ? Array.from(input.files) : [];
    input.value = "";
    if (!arr.length) return;
    setImgBusy(true);
    setError(null);
    const isLikelyImage = (file: File) => {
      if (file.type.startsWith("image/")) return true;
      if (!file.type && /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name)) return true;
      // 部分安卓相册：无 MIME、无扩展名，仍可能是照片
      if (!file.type && !file.name && file.size > 0 && file.size <= 12 * 1024 * 1024) return true;
      return false;
    };
    try {
      let cur = [...attachments];
      let nImg = cur.filter((a) => a.type === "image").length;
      let attempted = 0;
      for (const file of arr) {
        if (nImg >= 9) break;
        if (!isLikelyImage(file)) continue;
        attempted += 1;
        const { path } = await uploadReviewImage(file);
        cur = [...cur, { type: "image" as const, path }];
        nImg += 1;
      }
      setAttachments(cur);
      if (attempted === 0 && arr.length > 0) {
        setError("未识别为可上传图片（手机相册常无 MIME，请选 JPG/PNG；苹果「高效」格式为 HEIC，本应用已支持）");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片上传失败");
    } finally {
      setImgBusy(false);
    }
  };

  const removeMedia = async (p: string) => {
    if (!isEdit) {
      try {
        await deleteUploadedImage(p);
      } catch {
        /* 仍从列表移除 */
      }
    }
    setAttachments((list) => list.filter((x) => x.path !== p));
  };

  const handlePickVideos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const arr = input.files && input.files.length > 0 ? Array.from(input.files) : [];
    input.value = "";
    if (!arr.length) return;
    setVideoBusy(true);
    setError(null);
    try {
      let cur = [...attachments];
      let nVid = cur.filter((a) => a.type === "video").length;
      for (const file of arr) {
        if (nVid >= 3) break;
        const ok =
          file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name) || (!file.type && file.size > 0);
        if (!ok) continue;
        const { path } = await uploadReviewVideo(file);
        cur = [...cur, { type: "video" as const, path }];
        nVid += 1;
      }
      setAttachments(cur);
    } catch (err) {
      setError(err instanceof Error ? err.message : "视频上传失败");
    } finally {
      setVideoBusy(false);
    }
  };

  const validateForm = (): string | null => {
    if (!restaurantName.trim()) return "请填写餐馆名称";
    if (!city.trim()) return "请选择城市";
    if (avgPrice === "" || Number.isNaN(Number(avgPrice)) || Number(avgPrice) < 0) return "请填写有效的人均价格";
    if (!content.trim()) return "请填写评价";
    return null;
  };

  const buildPayload = (): ReviewPayload => {
    const dishList = dishes.map((x) => x.trim()).filter(Boolean);
    return {
      restaurant_name: restaurantName.trim(),
      dining_type: diningType,
      province,
      city: city.trim(),
      district: district.trim(),
      taste_score: taste,
      ...(diningType === "dine_in" ? { service_score: service, environment_score: env } : {}),
      value_score: value,
      avg_price: Number(avgPrice),
      dishes: dishList,
      recommend_tier: recommendTier,
      attachments,
      images: attachments.filter((a) => a.type === "image").map((a) => a.path),
      videos: attachments.filter((a) => a.type === "video").map((a) => a.path),
      content: content.trim(),
    };
  };

  const requestLocationStep = async () => {
    setError(null);
    const v = validateForm();
    if (v) {
      setError(v);
      return;
    }
    setLocBusy(true);
    try {
      const { suggestions } = await fetchReviewLocationSuggestions({
        restaurant_name: restaurantName.trim(),
        city: city.trim(),
        district: district.trim(),
      });
      if (!suggestions.length) {
        setError("高德未返回匹配位置，请核对店名与城市后重试");
        return;
      }
      setLocModal({ suggestions, index: 0, basePayload: buildPayload() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "位置检索失败");
    } finally {
      setLocBusy(false);
    }
  };

  const confirmLocationAndSave = async (s: ReviewPoiSuggestion) => {
    if (!locModal) return;
    const payload: ReviewPayload = {
      ...locModal.basePayload,
      latitude: s.latitude,
      longitude: s.longitude,
    };
    setSaving(true);
    setError(null);
    try {
      if (isEdit && initial) {
        await updateReview(initial.id, payload);
      } else {
        await createReview(payload);
      }
      setLocModal(null);
      await onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  let locationConfirmOverlay: React.ReactNode = null;
  if (locModal) {
    const cur = locModal.suggestions[locModal.index];
    const total = locModal.suggestions.length;
    const step = locModal.index + 1;
    if (cur) {
      const handleLocationNo = () => {
        if (saving) return;
        if (locModal.index < locModal.suggestions.length - 1) {
          setLocModal({ ...locModal, index: locModal.index + 1 });
        } else {
          const n = locModal.suggestions.length;
          setLocModal(null);
          setError(`在返回的 ${n} 条候选中均未确认，未保存。可修改店名或地区后重试。`);
        }
      };
      locationConfirmOverlay = (
        <div
          role="dialog"
          aria-modal
          aria-label="确认店铺位置"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.55)",
              zIndex: 200,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) setLocModal(null);
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: 20,
              width: "100%",
              maxWidth: 420,
              maxHeight: "88vh",
              overflow: "auto",
              boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>确认店铺位置</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
              高德检索结果 · 第 {step} / {total} 个候选
            </div>
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 12,
                marginBottom: 14,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 16 }}>{cur.name}</div>
              {cur.address && (
                <div style={{ fontSize: 14, marginTop: 8, lineHeight: 1.6, color: "var(--fg)" }}>
                  {cur.address}
                </div>
              )}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
              这是您要记录的店铺吗？点「是」提交，点「否」查看下一条。
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, width: "auto" }}
                disabled={saving}
                onClick={() => void confirmLocationAndSave(cur)}
              >
                {saving ? "保存中…" : "是"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                style={{ flex: 1, width: "auto" }}
                disabled={saving}
                onClick={handleLocationNo}
              >
                否
              </button>
            </div>
            <button
              type="button"
              className="btn-ghost"
              style={{ width: "100%", marginTop: 10 }}
              disabled={saving}
              onClick={() => setLocModal(null)}
            >
              取消
            </button>
          </div>
        </div>
      );
    }
  }

  return (
    <div
      className="sheet-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{isEdit ? "编辑点评" : "记一笔"}</div>
          <button type="button" className="btn-ghost" style={{ width: "auto", padding: "8px 12px" }} onClick={onClose}>
            关闭
          </button>
        </div>

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>{error}</div>
        )}

        <label className="label">餐馆名称</label>
        <input className="input" value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} />

        <label className="label" style={{ marginTop: 12 }}>
          就餐方式
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={diningType === "dine_in" ? "btn-primary" : "btn-ghost"}
            style={{ flex: 1, width: "auto" }}
            onClick={() => setDiningType("dine_in")}
          >
            堂食
          </button>
          <button
            type="button"
            className={diningType === "takeaway" ? "btn-primary" : "btn-ghost"}
            style={{ flex: 1, width: "auto" }}
            onClick={() => setDiningType("takeaway")}
          >
            外卖
          </button>
        </div>

        <label className="label" style={{ marginTop: 12 }}>
          在哪儿吃（省 / 市 / 区）
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <select
            className="input"
            value={province}
            onChange={(e) => {
              setProvince(e.target.value);
              setCity("");
              setDistrict("");
            }}
          >
            <option value="">省</option>
            {provinces.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setDistrict("");
            }}
            disabled={!province}
          >
            <option value="">市</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select className="input" value={district} onChange={(e) => setDistrict(e.target.value)} disabled={!city}>
            <option value="">区/县</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <ScoreSlider label="口味" value={taste} onChange={setTaste} />
        {diningType === "dine_in" && (
          <>
            <ScoreSlider label="服务" value={service} onChange={setService} />
            <ScoreSlider label="环境" value={env} onChange={setEnv} />
          </>
        )}
        <ScoreSlider label="性价比" value={value} onChange={setValue} />
        {diningType === "takeaway" && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
            外卖仅评口味与性价比；综合分会按两项平均计算。
          </div>
        )}

        <label className="label" style={{ marginTop: 12 }}>
          推荐度
        </label>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>这家店在你心里的档位</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {RECOMMEND_TIERS.map((t) => (
            <button
              key={t}
              type="button"
              className={recommendTier === t ? "btn-primary" : "btn-ghost"}
              style={{
                flex: "1 1 auto",
                minWidth: "calc(33% - 6px)",
                width: "auto",
                padding: "8px 6px",
                fontSize: 13,
                fontWeight: 700,
              }}
              onClick={() => setRecommendTier(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="label" style={{ marginTop: 8 }}>
          人均（元）
        </label>
        <input
          className="input"
          inputMode="numeric"
          value={avgPrice}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") setAvgPrice("");
            else if (/^\d+$/.test(v)) setAvgPrice(Number(v));
          }}
        />

        <label className="label" style={{ marginTop: 12 }}>
          推荐菜
        </label>
        {dishes.map((d, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              className="input"
              placeholder={`菜品 ${i + 1}`}
              value={d}
              onChange={(e) =>
                setDishes((arr) => {
                  const n = [...arr];
                  n[i] = e.target.value;
                  return n;
                })
              }
            />
          </div>
        ))}
        <button type="button" className="btn-ghost" style={{ width: "100%", marginBottom: 8 }} onClick={addDishRow}>
          + 再加一道
        </button>

        <label className="label" style={{ marginTop: 12 }}>
          配图与视频（图最多 9 张、视频最多 3 个）
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif"
          multiple
          hidden
          onChange={(e) => void handlePickImages(e)}
        />
        <input
          ref={videoRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
          multiple
          hidden
          onChange={(e) => void handlePickVideos(e)}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ width: "auto" }}
            disabled={imgBusy || imgCount >= 9}
            onClick={() => fileRef.current?.click()}
          >
            {imgBusy ? "上传图片中…" : imgCount >= 9 ? "图片已满 9 张" : "添加图片"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{ width: "auto" }}
            disabled={videoBusy || vidCount >= 3}
            onClick={() => videoRef.current?.click()}
          >
            {videoBusy ? "上传视频中…" : vidCount >= 3 ? "视频已满 3 个" : "添加视频"}
          </button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            图 {imgCount}/9 · 视频 {vidCount}/3
          </span>
        </div>
        {attachments.length > 0 && (
          <ReviewMediaGallery items={attachments} editable onRemove={(p) => void removeMedia(p)} />
        )}

        <label className="label">详细说一说吧</label>
        <textarea
          className="input"
          rows={5}
          maxLength={500}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{ resize: "vertical", minHeight: 110 }}
        />
        <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>{content.length}/500</div>

        <button
          type="button"
          className="btn-primary"
          style={{ marginTop: 8 }}
          disabled={saving || locBusy}
          onClick={() => void requestLocationStep()}
        >
          {saving ? "保存中…" : locBusy ? "检索位置中…" : isEdit ? "保存修改" : "发布"}
        </button>

        {locationConfirmOverlay}
      </div>
    </div>
  );
}

function ScoreSlider({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="label">
        {label}：{value.toFixed(1)} / 5
      </div>
      <div className="slider-row">
        <span style={{ fontSize: 11, color: "var(--muted)", width: 22 }}>0</span>
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span style={{ fontSize: 11, color: "var(--muted)", width: 22, textAlign: "right" }}>5</span>
      </div>
    </div>
  );
}
