import { useEffect, useState } from "react";
import type { RegionProvince, Review } from "../api";
import { createReview, updateReview } from "../api";

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
