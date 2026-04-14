import { useEffect, useRef, useState } from "react";
import type { RegionProvince, Review } from "../api";
import { createReview, deleteUploadedImage, updateReview, uploadReviewImage } from "../api";
import { RECOMMEND_TIERS, type RecommendTier } from "../recommendTier";
import { ReviewImageGallery } from "./ReviewImageGallery";

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
  const [images, setImages] = useState<string[]>([]);
  const [imgBusy, setImgBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
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
      setImages(Array.isArray(initial.images) ? [...initial.images] : []);
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
      setImages([]);
    }
    setError(null);
  }, [initial]);

  const provinces = regions.map((p) => p.name);
  const cities =
    regions.find((p) => p.name === province)?.cities.map((c) => c.name) ??
    ([] as string[]);
  const districts =
    regions.find((p) => p.name === province)?.cities.find((c) => c.name === city)?.districts ?? [];

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
      let cur = [...images];
      let attempted = 0;
      for (const file of arr) {
        if (cur.length >= 9) break;
        if (!isLikelyImage(file)) continue;
        attempted += 1;
        const { path } = await uploadReviewImage(file);
        cur = [...cur, path];
      }
      setImages(cur.slice(0, 9));
      if (attempted === 0 && arr.length > 0) {
        setError("未识别为可上传图片（手机相册常无 MIME，请选 JPG/PNG；苹果「高效」格式为 HEIC，本应用已支持）");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片上传失败");
    } finally {
      setImgBusy(false);
    }
  };

  const removeImage = async (p: string) => {
    if (!isEdit) {
      try {
        await deleteUploadedImage(p);
      } catch {
        /* 仍从列表移除 */
      }
    }
    setImages((im) => im.filter((x) => x !== p));
  };

  const save = async () => {
    setError(null);
    if (!restaurantName.trim()) {
      setError("请填写餐馆名称");
      return;
    }
    if (!city.trim()) {
      setError("请选择城市");
      return;
    }
    if (avgPrice === "" || Number.isNaN(Number(avgPrice)) || Number(avgPrice) < 0) {
      setError("请填写有效的人均价格");
      return;
    }
    const dishList = dishes.map((x) => x.trim()).filter(Boolean);
    if (!content.trim()) {
      setError("请填写评价");
      return;
    }
    const payload = {
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
      images,
      content: content.trim(),
    };
    setSaving(true);
    try {
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
      <div className="sheet" role="dialog" aria-modal onMouseDown={(e) => e.stopPropagation()}>
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
          配图（最多 9 张）
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif"
          multiple
          hidden
          onChange={(e) => void handlePickImages(e)}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ width: "auto" }}
            disabled={imgBusy || images.length >= 9}
            onClick={() => fileRef.current?.click()}
          >
            {imgBusy ? "上传中…" : images.length >= 9 ? "已达 9 张" : "选择图片"}
          </button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>已选 {images.length}/9</span>
        </div>
        {images.length > 0 && (
          <ReviewImageGallery paths={images} editable onRemove={(p) => void removeImage(p)} />
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

        <button type="button" className="btn-primary" style={{ marginTop: 8 }} disabled={saving} onClick={() => void save()}>
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
