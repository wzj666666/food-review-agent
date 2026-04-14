import { useCallback, useEffect, useState } from "react";
import { mediaUrl } from "../api";

type Props = {
  paths: string[];
  /** 编辑态：显示删除角标 */
  editable?: boolean;
  onRemove?: (path: string) => void;
};

export function ReviewImageGallery({ paths, editable, onRemove }: Props) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    if (lightbox == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowLeft" && paths.length > 1) setLightbox((i) => (i == null ? i : (i - 1 + paths.length) % paths.length));
      if (e.key === "ArrowRight" && paths.length > 1) setLightbox((i) => (i == null ? i : (i + 1) % paths.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, paths.length]);

  const goPrev = useCallback(() => {
    setLightbox((i) => (i == null ? i : (i - 1 + paths.length) % paths.length));
  }, [paths.length]);

  const goNext = useCallback(() => {
    setLightbox((i) => (i == null ? i : (i + 1) % paths.length));
  }, [paths.length]);

  if (!paths.length) return null;

  const cur = lightbox != null ? paths[lightbox] : null;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {paths.map((p, idx) => (
          <div key={p} style={{ position: "relative", width: 72, height: 72, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setLightbox(idx)}
              style={{
                width: "100%",
                height: "100%",
                padding: 0,
                border: "1px solid var(--border)",
                borderRadius: 10,
                overflow: "hidden",
                cursor: "pointer",
                background: "var(--bg-2)",
              }}
              aria-label={`查看大图 ${idx + 1}`}
            >
              <img
                src={mediaUrl(p)}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                loading="lazy"
              />
            </button>
            {editable && onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(p);
                }}
                aria-label="移除"
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  border: "none",
                  background: "var(--danger)",
                  color: "#fff",
                  fontSize: 14,
                  lineHeight: 1,
                  cursor: "pointer",
                  boxShadow: "var(--shadow-soft)",
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {lightbox != null && cur && (
        <div
          className="sheet-overlay"
          style={{ zIndex: 120, alignItems: "center", justifyContent: "center", padding: 12 }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLightbox(null);
          }}
          onTouchEnd={(e) => {
            if (e.target === e.currentTarget) setLightbox(null);
          }}
        >
          <div
            role="dialog"
            aria-modal
            aria-label="大图预览"
            style={{
              position: "relative",
              maxWidth: "min(96vw, 520px)",
              maxHeight: "88dvh",
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: 10,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img
                src={mediaUrl(cur)}
                alt=""
                style={{ maxWidth: "100%", maxHeight: "72dvh", objectFit: "contain", borderRadius: 12 }}
              />
              {paths.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={goPrev}
                    style={{
                      position: "absolute",
                      left: 4,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      border: "none",
                      background: "rgba(0,0,0,0.45)",
                      color: "#fff",
                      fontSize: 20,
                      cursor: "pointer",
                    }}
                    aria-label="上一张"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    style={{
                      position: "absolute",
                      right: 4,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      border: "none",
                      background: "rgba(0,0,0,0.45)",
                      color: "#fff",
                      fontSize: 20,
                      cursor: "pointer",
                    }}
                    aria-label="下一张"
                  >
                    ›
                  </button>
                </>
              )}
            </div>
            <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)" }}>点击背景空白处或按 Esc 关闭</div>
            {paths.length > 1 && (
              <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                {lightbox + 1} / {paths.length}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
