import { mediaUrl } from "../api";

type Props = {
  paths: string[];
  /** 编辑态：显示删除 */
  editable?: boolean;
  onRemove?: (path: string) => void;
};

export function ReviewVideoList({ paths, editable, onRemove }: Props) {
  if (!paths.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
      {paths.map((p) => (
        <div key={p} style={{ position: "relative" }}>
          <video
            src={mediaUrl(p)}
            controls
            playsInline
            preload="metadata"
            style={{
              width: "100%",
              maxHeight: 220,
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "#000",
            }}
          />
          {editable && onRemove && (
            <button
              type="button"
              onClick={() => onRemove(p)}
              aria-label="移除视频"
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: "none",
                background: "var(--danger)",
                color: "#fff",
                fontSize: 16,
                lineHeight: 1,
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
