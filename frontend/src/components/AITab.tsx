import { useEffect, useRef, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { aiChatStream } from "../api";

type Msg = { id: string; role: "user" | "assistant"; content: string };

/** 宽表格横向滚动 */
const CHAT_MD_COMPONENTS: Partial<Components> = {
  table({ children, ...props }) {
    return (
      <div className="table-wrap">
        <table {...props}>{children}</table>
      </div>
    );
  },
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_ASSISTANT_WELCOME =
  "嗨，我是美食小参谋～如果你想了解周边美食、规划路线、查询天气、地点搜索等，我会用实时数据回答，我也可以回答和点评相关的问题～";

function initialMessages(): Msg[] {
  return [{ id: newId(), role: "assistant", content: DEFAULT_ASSISTANT_WELCOME }];
}

export function AITab() {
  const [messages, setMessages] = useState<Msg[]>(() => initialMessages());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);
    const userMsg: Msg = { id: newId(), role: "user", content: text };
    const assistantId = newId();
    const assistantPlaceholder: Msg = { id: assistantId, role: "assistant", content: "" };
    setMessages((m) => [...m, userMsg, assistantPlaceholder]);
    setInput("");
    setLoading(true);
    try {
      const historyForApi = [...messages, userMsg];
      // system 与人设 + 全库点评由后端注入，这里只传 user/assistant
      const payloadMessages = historyForApi.map((x) => ({ role: x.role, content: x.content }));
      await aiChatStream(payloadMessages, (delta) => {
        setMessages((msgs) => {
          const i = msgs.findIndex((m) => m.id === assistantId);
          if (i < 0) return msgs;
          const copy = [...msgs];
          const cur = copy[i];
          if (!cur) return msgs;
          copy[i] = { ...cur, content: cur.content + delta };
          return copy;
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "请求失败";
      setError(msg);
      setMessages((m) => {
        const withoutEmptyAssistant = m.filter((x) => !(x.id === assistantId && x.role === "assistant" && x.content === ""));
        return [
          ...withoutEmptyAssistant,
          {
            id: newId(),
            role: "assistant",
            content: `暂时无法使用参谋：${msg}\n`,
          },
        ];
      });
    } finally {
      setLoading(false);
    }
  };

  const startNewChat = () => {
    setMessages(initialMessages());
    setInput("");
    setError(null);
    setLoading(false);
  };

  return (
    <div style={{ padding: "16px 16px 8px", display: "flex", flexDirection: "column", height: "calc(100dvh - 88px)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.2 }}>美食小参谋</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>你的AI参谋</div>
        </div>
        <button
          type="button"
          className="btn-ghost"
          aria-label="新对话"
          onClick={() => startNewChat()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            padding: "8px 12px",
            borderRadius: 14,
          }}
        >
          <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }} aria-hidden>
            +
          </span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>新对话</span>
        </button>
      </header>

      {error && (
        <div style={{ marginTop: 10, color: "var(--danger)", fontSize: 13 }}>{error}</div>
      )}

      <div className="card" style={{ flex: 1, marginTop: 12, padding: 12, overflow: "auto" }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              marginBottom: 12,
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              width: "100%",
              minWidth: 0,
            }}
          >
            <div
              className={m.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}
              style={{
                maxWidth: "92%",
                minWidth: 0,
                padding: "10px 12px",
                borderRadius: 16,
                lineHeight: 1.55,
                whiteSpace: m.role === "user" ? "pre-wrap" : undefined,
                minHeight: m.role === "assistant" && m.content === "" && loading ? 24 : undefined,
              }}
            >
              {m.role === "assistant" ? (
                m.content ? (
                  <ReactMarkdown
                    className="chat-md"
                    remarkPlugins={[remarkGfm]}
                    components={CHAT_MD_COMPONENTS}
                  >
                    {m.content}
                  </ReactMarkdown>
                ) : loading ? (
                  "…"
                ) : (
                  ""
                )
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 8 }}>正在生成…</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
        <textarea
          className="input"
          rows={2}
          placeholder="输入消息"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          style={{ resize: "none", flex: 1 }}
        />
        <button
          type="button"
          className="btn-primary"
          style={{ width: 88, height: 48 }}
          disabled={loading || !input.trim()}
          onClick={() => void send()}
        >
          发送
        </button>
      </div>
    </div>
  );
}
