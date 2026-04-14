const TOKEN_KEY = "dp_token";

/** 无末尾斜杠；空字符串表示与当前页面同源（浏览器走 FastAPI、或 Capacitor 使用 server.url 时） */
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/$/, "") ?? "";

function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_ORIGIN}${p}`;
}

/** 点评配图、上传文件等静态路径（与页面可能不同源时使用 VITE_API_ORIGIN） */
export function mediaUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return apiUrl(path);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    throw new Error("UNAUTHORIZED");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { detail?: string | { msg: string }[] };
      if (typeof j.detail === "string") detail = j.detail;
      else if (Array.isArray(j.detail)) detail = j.detail.map((x) => x.msg).join("; ");
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

export type UserPublic = {
  id: number;
  username: string;
  display_name: string;
  bio: string;
  city: string;
  created_at: string;
};

export type Review = {
  id: number;
  user_id: number;
  author_username: string;
  restaurant_name: string;
  dining_type: string;
  province: string;
  city: string;
  district: string;
  taste_score: number;
  service_score: number;
  environment_score: number;
  value_score: number;
  avg_price: number;
  dishes: string[];
  images: string[];
  content: string;
  created_at: string;
  overall_score: number;
};

export type RegionProvince = {
  name: string;
  cities: { name: string; districts: string[] }[];
};

export async function register(username: string, password: string) {
  return apiFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  }) as Promise<UserPublic>;
}

export async function login(username: string, password: string) {
  const r = (await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })) as { access_token: string };
  setToken(r.access_token);
}

export async function fetchMe() {
  return apiFetch("/api/me") as Promise<UserPublic>;
}

export async function updateMe(patch: { display_name?: string; bio?: string; city?: string }) {
  return apiFetch("/api/me", { method: "PATCH", body: JSON.stringify(patch) }) as Promise<UserPublic>;
}

export async function fetchStats() {
  return apiFetch("/api/me/stats") as Promise<{
    review_count: number;
    restaurant_count: number;
    restaurants: string[];
  }>;
}

export async function fetchRegions() {
  return apiFetch("/api/regions") as Promise<RegionProvince[]>;
}

export type SortKey = "time_desc" | "time_asc" | "score_desc" | "score_asc";

export async function fetchReviews(params: { q?: string; sort: SortKey }) {
  const sp = new URLSearchParams();
  if (params.q?.trim()) sp.set("q", params.q.trim());
  sp.set("sort", params.sort);
  const qs = sp.toString();
  return apiFetch(`/api/reviews?${qs}`) as Promise<Review[]>;
}

export type ReviewPayload = {
  restaurant_name: string;
  dining_type: "dine_in" | "takeaway";
  province: string;
  city: string;
  district: string;
  taste_score: number;
  service_score?: number | null;
  environment_score?: number | null;
  value_score: number;
  avg_price: number;
  dishes: string[];
  images?: string[];
  content: string;
};

export async function uploadReviewImage(file: File): Promise<{ path: string }> {
  const token = getToken();
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(apiUrl("/api/uploads/review-image"), {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (res.status === 401) {
    setToken(null);
    throw new Error("UNAUTHORIZED");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { detail?: string };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<{ path: string }>;
}

export async function deleteUploadedImage(path: string): Promise<void> {
  await apiFetch("/api/uploads/review-image/delete", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export async function createReview(body: ReviewPayload) {
  return apiFetch("/api/reviews", { method: "POST", body: JSON.stringify(body) }) as Promise<Review>;
}

export async function updateReview(id: number, body: ReviewPayload) {
  return apiFetch(`/api/reviews/${id}`, { method: "PUT", body: JSON.stringify(body) }) as Promise<Review>;
}

export async function deleteReview(id: number) {
  await apiFetch(`/api/reviews/${id}`, { method: "DELETE" });
}

export async function fetchMyReviews() {
  return apiFetch("/api/reviews/mine") as Promise<Review[]>;
}

/** 流式调用 /api/ai/chat（SSE），仅拼接 delta.content，忽略 reasoning。 */
export async function aiChatStream(
  messages: { role: "user" | "assistant"; content: string }[],
  onDelta: (chunk: string) => void,
): Promise<void> {
  const token = getToken();
  const res = await fetch(apiUrl("/api/ai/chat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages }),
  });
  if (res.status === 401) {
    setToken(null);
    throw new Error("UNAUTHORIZED");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { detail?: string | { msg: string }[] };
      if (typeof j.detail === "string") detail = j.detail;
      else if (Array.isArray(j.detail)) detail = j.detail.map((x) => x.msg).join("; ");
    } catch {
      try {
        const t = await res.text();
        if (t) detail = t.slice(0, 500);
      } catch {
        /* ignore */
      }
    }
    throw new Error(detail);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("无响应体");
  const dec = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const rawLine = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const line = rawLine.replace(/\r$/, "");
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.startsWith("data: ") ? trimmed.slice(6).trim() : trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const j = JSON.parse(payload) as {
          choices?: { delta?: { content?: string | null; reasoning_content?: string | null } }[];
        };
        const d = j.choices?.[0]?.delta;
        const piece = d?.content;
        if (typeof piece === "string" && piece.length > 0) onDelta(piece);
      } catch {
        /* 非 JSON 行或截断，忽略 */
      }
    }
  }
}
