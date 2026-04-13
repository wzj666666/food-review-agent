import { useState } from "react";
import { getToken, login, register } from "../api";

type Props = {
  onLoggedIn: () => void;
  bootError: string | null;
};

export function LoginScreen({ onLoggedIn, bootError }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      if (mode === "register") {
        await register(username.trim(), password);
        await login(username.trim(), password);
      } else {
        await login(username.trim(), password);
      }
      if (!getToken()) {
        throw new Error("登录失败");
      }
      onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "出错了");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell" style={{ padding: "24px 20px" }}>
      <div style={{ maxWidth: 400, margin: "0 auto", paddingTop: "8vh" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 0.2 }}>个人点评</div>
          <div style={{ color: "var(--muted)", marginTop: 8, fontSize: 14 }}>好吃就记下来</div>
        </div>

        {(bootError || error) && (
          <div
            className="card"
            style={{
              padding: 12,
              marginBottom: 16,
              borderColor: "rgba(248,113,113,0.35)",
              color: "var(--danger)",
              fontSize: 13,
            }}
          >
            {error || bootError}
          </div>
        )}

        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <button
              type="button"
              className={mode === "login" ? "btn-primary" : "btn-ghost"}
              style={{ flex: 1, width: "auto" }}
              onClick={() => setMode("login")}
            >
              登录
            </button>
            <button
              type="button"
              className={mode === "register" ? "btn-primary" : "btn-ghost"}
              style={{ flex: 1, width: "auto" }}
              onClick={() => setMode("register")}
            >
              注册
            </button>
          </div>

          <label className="label">账号</label>
          <input
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
          />

          <label className="label" style={{ marginTop: 14 }}>
            密码
          </label>
          <input
            className="input"
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 4 位"
          />

          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 20 }}
            disabled={loading || username.trim().length < 2 || password.length < 4}
            onClick={() => void submit()}
          >
            {loading ? "请稍候…" : mode === "login" ? "进入应用" : "注册并登录"}
          </button>

        </div>
      </div>
    </div>
  );
}
