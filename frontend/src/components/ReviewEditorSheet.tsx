import { useEffect, useRef, useState } from "react";
import type {
  AttachmentItem,
  RegionProvince,
  Review,
  ReviewInputTipItem,
  ReviewPayload,
} from "../api";
import {
  createReview,
  deleteUploadedImage,
  fetchReviewInputTips,
  updateReview,
  uploadReviewImage,
  uploadReviewVideo,
  mergeReviewMedia,
} from "../api";
import { RECOMMEND_TIERS, type RecommendTier } from "../recommendTier";
import { ReviewMediaGallery } from "./ReviewMediaGallery";


/** 与高德输入提示列表中的匹配高亮相近 */
const TIP_MATCH_COLOR = "#156ed3";

function highlightQuery(text: string, q: string): React.ReactNode {
  const qq = q.trim();
  if (!qq) return text;
  const nodes: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const i = rest.indexOf(qq);
    if (i < 0) {
      nodes.push(<span key={key++}>{rest}</span>);
      break;
    }
    if (i > 0) nodes.push(<span key={key++}>{rest.slice(0, i)}</span>);
    nodes.push(
      <span key={key++} style={{ color: TIP_MATCH_COLOR, fontWeight: 700 }}>
        {rest.slice(i, i + qq.length)}
      </span>,
    );
    rest = rest.slice(i + qq.length);
  }
  return <>{nodes}</>;
}

function InputTipIcon({ kind }: { kind: ReviewInputTipItem["kind"] }) {
  const box = { width: 26, height: 40, flexShrink: 0, display: "grid", placeItems: "center" as const };
  if (kind === "keyword") {
    return (
      <span style={{ ...box, color: "var(--muted)" }} aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="10" cy="10" r="6.5" />
          <path d="M15 15l6 6" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (kind === "bus") {
    return (
      <span style={{ ...box, color: "var(--muted)" }} aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="7" width="16" height="9" rx="1.2" />
          <path d="M6 11h12M7 16h2M15 16h2" strokeLinecap="round" />
          <circle cx="8" cy="18" r="1.4" fill="currentColor" />
          <circle cx="16" cy="18" r="1.4" fill="currentColor" />
        </svg>
      </span>
    );
  }
  return (
    <span style={{ ...box, color: "var(--muted)" }} aria-hidden>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.25a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5z" />
      </svg>
    </span>
  );
}

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
  /** 从输入提示点选后锁定的经纬度（null 表示未选，提交时直接留空） */
  const [pickedLat, setPickedLat] = useState<number | null>(null);
  const [pickedLng, setPickedLng] = useState<number | null>(null);
  /** 点选 tip 后展示给用户的副标题文案 */
  const [pickedAddress, setPickedAddress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [inputTips, setInputTips] = useState<ReviewInputTipItem[]>([]);
  const [tipsLoading, setTipsLoading] = useState(false);
  const [nameFieldFocused, setNameFieldFocused] = useState(false);
  const nameBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setProvince("");
      setCity("");
      setDistrict("");
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
    setInputTips([]);
    setPickedLat(null);
    setPickedLng(null);
    setPickedAddress("");
  }, [initial]);

  useEffect(() => {
    const q = restaurantName.trim();
    if (q.length < 1) {
      setInputTips([]);
      setTipsLoading(false);
      return;
    }
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      setTipsLoading(true);
      void (async () => {
        try {
          const { tips } = await fetchReviewInputTips({
            keywords: q,
            city: city.trim(),
            signal: ac.signal,
          });
          if (!ac.signal.aborted) setInputTips(tips.filter((t) => t.kind !== "bus"));
        } catch {
          if (!ac.signal.aborted) setInputTips([]);
        } finally {
          if (!ac.signal.aborted) setTipsLoading(false);
        }
      })();
    }, 320);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [restaurantName, city]);

  useEffect(
    () => () => {
      if (nameBlurTimer.current) clearTimeout(nameBlurTimer.current);
    },
    [],
  );

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
    if (!city.trim() && pickedLat === null) return "请点击提示选择位置，或在下方手动选择所在城市";
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
      ...(pickedLat !== null && pickedLng !== null ? { latitude: pickedLat, longitude: pickedLng } : {}),
    };
  };

  const handleSubmit = async () => {
    setError(null);
    const v = validateForm();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isEdit && initial) {
        await updateReview(initial.id, payload);
      } else {
        await createReview(payload);
      }
      await onSuccess();
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

        <label className="label" htmlFor="review-restaurant-name">
          餐馆名称
        </label>
        <div style={{ position: "relative", zIndex: 2 }}>
          <input
            id="review-restaurant-name"
            className="input"
            value={restaurantName}
            autoComplete="off"
            aria-expanded={nameFieldFocused && (inputTips.length > 0 || tipsLoading)}
            aria-controls="review-restaurant-tips"
            onChange={(e) => {
              setRestaurantName(e.target.value);
              // 手动改名时清除已选位置
              setPickedLat(null);
              setPickedLng(null);
              setPickedAddress("");
            }}
            onFocus={() => {
              if (nameBlurTimer.current) {
                clearTimeout(nameBlurTimer.current);
                nameBlurTimer.current = null;
              }
              setNameFieldFocused(true);
            }}
            onBlur={() => {
              nameBlurTimer.current = setTimeout(() => setNameFieldFocused(false), 160);
            }}
          />
          {nameFieldFocused && restaurantName.trim().length >= 1 && (inputTips.length > 0 || tipsLoading) && (
            <div
              id="review-restaurant-tips"
              role="listbox"
              aria-label="店名联想"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "calc(100% + 4px)",
                maxHeight: 320,
                overflowY: "auto",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                boxShadow: "var(--shadow)",
              }}
            >
              {tipsLoading && inputTips.length === 0 && (
                <div style={{ padding: 12, fontSize: 13, color: "var(--muted)" }}>加载联想…</div>
              )}
              {inputTips.map((tip, idx) => (
                <button
                  key={`${tip.name}-${idx}`}
                  type="button"
                  role="option"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setRestaurantName(tip.name);
                    setInputTips([]);
                    setNameFieldFocused(false);
                    if (tip.latitude != null && tip.longitude != null) {
                      setPickedLat(tip.latitude);
                      setPickedLng(tip.longitude);
                      setPickedAddress(tip.subtitle || tip.name);
                      // 直接写入原始字符串，不再尝试匹配下拉列表
                      setProvince(tip.province ?? "");
                      setCity(tip.city ?? "");
                      setDistrict(tip.district ?? "");
                    } else {
                      setPickedLat(null);
                      setPickedLng(null);
                      setPickedAddress("");
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 10px 10px 4px",
                    gap: 4,
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    background: "transparent",
                    cursor: "pointer",
                    borderRadius: 0,
                  }}
                >
                  <InputTipIcon kind={tip.kind} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35, color: "var(--text)" }}>
                      {highlightQuery(tip.name, restaurantName)}
                    </div>
                    {tip.subtitle ? (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          marginTop: 4,
                          lineHeight: 1.45,
                          wordBreak: "break-all",
                        }}
                      >
                        {tip.subtitle}
                      </div>
                    ) : null}
                  </div>
                  <span
                    style={{
                      alignSelf: "center",
                      color: "var(--border)",
                      fontSize: 16,
                      paddingLeft: 4,
                      flexShrink: 0,
                    }}
                    aria-hidden
                  >
                    ↗
                  </span>
                </button>
              ))}
              {tipsLoading && inputTips.length > 0 && (
                <div style={{ padding: 8, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>更新中…</div>
              )}
            </div>
          )}
        </div>
        {pickedLat !== null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 6,
              padding: "6px 10px",
              background: "var(--accent-soft)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--text)",
            }}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="var(--accent)" style={{ flexShrink: 0 }}>
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.25a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5z" />
            </svg>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pickedAddress}
            </span>
            <button
              type="button"
              aria-label="清除已选位置"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setPickedLat(null);
                setPickedLng(null);
                setPickedAddress("");
                setProvince("");
                setCity("");
                setDistrict("");
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0 2px",
                color: "var(--muted)",
                fontSize: 15,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )}

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
        {pickedLat !== null ? (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--bg-2)",
              borderRadius: 10,
              fontSize: 14,
              color: "var(--text)",
              lineHeight: 1.5,
            }}
          >
            {[province, city, district].filter(Boolean).join(" / ") || "—"}
            <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 6 }}>
              （已由位置提示自动填入，点击上方 × 可清除后手动选择）
            </span>
          </div>
        ) : (
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
        )}

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
          disabled={saving}
          onClick={() => void handleSubmit()}
        >
          {saving ? "保存中…" : isEdit ? "保存修改" : "发布"}
        </button>
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
