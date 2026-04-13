import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { aiChatStream } from "../api";

type Msg = { id: string; role: "user" | "assistant"; content: string };

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function AITab() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: newId(),
      role: "assistant",
      content:
        "嗨，我是美食小参谋～你可以问哪家好吃、人均多少、某类菜的口碑等，当然我也可以回答其他任何问题～",
    },
  ]);
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
            content: `暂时无法调用模型：${msg}\n请确认本机 8020 已启动，且点评服务已配置 AI_API_KEY（若 vLLM 开启了 --api-key）。`,
          },
        ];
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "16px 16px 8px", display: "flex", flexDirection: "column", height: "calc(100dvh - 88px)" }}>
      <header>
        <div style={{ fontSize: 22, fontWeight: 800 }}>美食小参谋</div>
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
            }}
          >
            <div
              className={m.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}
              style={{
                maxWidth: "92%",
                padding: "10px 12px",
                borderRadius: 16,
                lineHeight: 1.55,
                whiteSpace: m.role === "user" ? "pre-wrap" : undefined,
                minHeight: m.role === "assistant" && m.content === "" && loading ? 24 : undefined,
              }}
            >
              {m.role === "assistant" ? (
                m.content ? (
                  <ReactMarkdown className="chat-md">{m.content}</ReactMarkdown>
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
          placeholder="输入消息，回车发送（Shift+回车换行）"
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
