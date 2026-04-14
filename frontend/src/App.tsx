import { useCallback, useEffect, useState } from "react";
import type { UserPublic } from "./api";
import { fetchMe, getToken, setToken } from "./api";
import { AITab } from "./components/AITab";
import { LoginScreen } from "./components/LoginScreen";
import { ProfileTab } from "./components/ProfileTab";
import { ReviewsTab } from "./components/ReviewsTab";

export type TabKey = "reviews" | "ai" | "me";

export default function App() {
  const [token, setTok] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<UserPublic | null>(null);
  const [tab, setTab] = useState<TabKey>("reviews");
  const [bootError, setBootError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const u = await fetchMe();
      setUser(u);
      setBootError(null);
    } catch (e) {
      setUser(null);
      setToken(null);
      setTok(null);
      if (e instanceof Error && e.message !== "UNAUTHORIZED") {
        setBootError(e.message);
      }
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    void refreshUser();
  }, [token, refreshUser]);

  const logout = () => {
    setToken(null);
    setTok(null);
    setUser(null);
    setTab("reviews");
  };

  if (!token || !user) {
    return (
      <LoginScreen
        onLoggedIn={() => {
          const t = getToken();
          setTok(t);
        }}
        bootError={bootError}
      />
    );
  }

  return (
    <div className="app-shell">
      {/* 点评 / 我的：仅当前 Tab 挂载，切换即刷新；参谋：始终挂载，离开参谋再回来仍保留对话 */}
      {tab === "reviews" && <ReviewsTab />}
      <div style={{ display: tab === "ai" ? "block" : "none" }}>
        <AITab />
      </div>
      {tab === "me" && <ProfileTab user={user} onUserUpdated={setUser} onLogout={logout} />}

      <nav className="tabs" aria-label="主导航">
        <button
          type="button"
          className={`tab-btn ${tab === "reviews" ? "active" : ""}`}
          onClick={() => setTab("reviews")}
        >
          <span className="tab-icon" aria-hidden>
            ★
          </span>
          点评
        </button>
        <button type="button" className={`tab-btn ${tab === "ai" ? "active" : ""}`} onClick={() => setTab("ai")}>
          <span className="tab-icon" aria-hidden>
            ✦
          </span>
          参谋
        </button>
        <button type="button" className={`tab-btn ${tab === "me" ? "active" : ""}`} onClick={() => setTab("me")}>
          <span className="tab-icon" aria-hidden>
            ◎
          </span>
          我的
        </button>
      </nav>
    </div>
  );
}
