import { useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl, type AttachmentItem } from "../api";

/** 缩略图：seek 到首帧附近并暂停，避免仅 metadata 时整片灰/黑 */
function VideoThumb({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const paintFirst = useCallback(() => {
    const v = ref.current;
    if (!v || v.readyState < 2) return;
    try {
      const d = v.duration;
      const t =
        d && Number.isFinite(d) && d > 0 ? Math.min(0.05, Math.max(0.001, d * 1e-6)) : 0.001;
      v.currentTime = t;
    } catch {
      v.currentTime = 0.001;
    }
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="auto"
      onLoadedData={paintFirst}
      onLoadedMetadata={paintFirst}
      onSeeked={(e) => {
        e.currentTarget.pause();
      }}
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
    />
  );
}

type Props = {
  items: AttachmentItem[];
  editable?: boolean;
  onRemove?: (path: string) => void;
};

export function ReviewMediaGallery({ items, editable, onRemove }: Props) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    if (lightbox == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowLeft" && items.length > 1) {
        setLightbox((i) => (i == null ? i : (i - 1 + items.length) % items.length));
      }
      if (e.key === "ArrowRight" && items.length > 1) {
        setLightbox((i) => (i == null ? i : (i + 1) % items.length));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, items.length]);

  const goPrev = useCallback(() => {
    setLightbox((i) => (i == null ? i : (i - 1 + items.length) % items.length));
  }, [items.length]);

  const goNext = useCallback(() => {
    setLightbox((i) => (i == null ? i : (i + 1) % items.length));
  }, [items.length]);

  if (!items.length) return null;

  const cur = lightbox != null ? items[lightbox] : null;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "flex-start" }}>
        {items.map((it, idx) => (
          <div key={`${it.type}-${it.path}`} style={{ position: "relative", width: 72, height: 72, flexShrink: 0 }}>
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
              aria-label={it.type === "image" ? `查看图片 ${idx + 1}` : `播放视频 ${idx + 1}`}
            >
              {it.type === "image" ? (
                <img
                  src={mediaUrl(it.path)}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  loading="lazy"
                />
              ) : (
                <VideoThumb src={mediaUrl(it.path)} />
              )}
            </button>
            {it.type === "video" && (
              <div
                style={{
                  position: "absolute",
                  bottom: 2,
                  left: 2,
                  fontSize: 9,
                  fontWeight: 700,
                  color: "#fff",
                  textShadow: "0 0 4px #000",
                  pointerEvents: "none",
                }}
              >
                ▶
              </div>
            )}
            {editable && onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(it.path);
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
        >
          <div
            role="dialog"
            aria-modal
            aria-label="媒体预览"
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
            <div
              style={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#000",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {cur.type === "image" ? (
                <img
                  src={mediaUrl(cur.path)}
                  alt=""
                  style={{ maxWidth: "100%", maxHeight: "72dvh", objectFit: "contain" }}
                />
              ) : (
                <video
                  src={mediaUrl(cur.path)}
                  controls
                  playsInline
                  autoPlay
                  style={{ maxWidth: "100%", maxHeight: "72dvh" }}
                />
              )}
              {items.length > 1 && (
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
                    aria-label="上一个"
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
                    aria-label="下一个"
                  >
                    ›
                  </button>
                </>
              )}
            </div>
            <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
              点击背景空白处或按 Esc 关闭
            </div>
            {items.length > 1 && (
              <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                {lightbox + 1} / {items.length}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
