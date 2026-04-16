const TOKEN_KEY = "dp_token";

/** 同一次 fetch read 里会解析出多行 SSE；若连续 onDelta→setState，React 18 会批成一次渲染，看起来像非流式。 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

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

export type AttachmentItem = { type: "image" | "video"; path: string };

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
  recommend_tier?: string;
  images: string[];
  videos?: string[];
  /** 有则按顺序展示（与图片/视频穿插）；旧数据仅有 images+videos 时前端合并 */
  attachments?: AttachmentItem[];
  content: string;
  latitude?: number | null;
  longitude?: number | null;
  created_at: string;
  overall_score: number;
};

/** 列表/详情展示用：优先 attachments，否则先图后视频 */
export function mergeReviewMedia(r: Pick<Review, "attachments" | "images" | "videos">): AttachmentItem[] {
  if (r.attachments && r.attachments.length > 0) return r.attachments;
  const out: AttachmentItem[] = [];
  for (const p of r.images ?? []) out.push({ type: "image", path: p });
  for (const p of r.videos ?? []) out.push({ type: "video", path: p });
  return out;
}

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
  recommend_tier: "夯" | "顶级" | "人上人" | "NPC" | "拉完了";
  images?: string[];
  videos?: string[];
  attachments?: AttachmentItem[];
  content: string;
  /** 提交前经高德检索弹窗确认后必填 */
  latitude?: number;
  longitude?: number;
};

export type ReviewPoiSuggestion = {
  name: string;
  address: string;
  longitude: number;
  latitude: number;
  adcode?: string;
  type?: string;
};

export type ReviewInputTipItem = {
  name: string;
  subtitle: string;
  kind: "poi" | "bus" | "keyword";
  longitude?: number | null;
  latitude?: number | null;
  province?: string;
  city?: string;
  district?: string;
};

export async function fetchReviewInputTips(params: {
  keywords: string;
  city: string;
  signal?: AbortSignal;
}) {
  const sp = new URLSearchParams();
  sp.set("keywords", params.keywords.trim());
  const c = params.city.trim();
  if (c) sp.set("city", c);
  return apiFetch(`/api/reviews/input-tips?${sp.toString()}`, {
    method: "GET",
    signal: params.signal,
  }) as Promise<{ tips: ReviewInputTipItem[] }>;
}

export async function fetchReviewLocationSuggestions(body: {
  restaurant_name: string;
  city: string;
  district: string;
}) {
  return apiFetch("/api/reviews/location-suggestions", {
    method: "POST",
    body: JSON.stringify(body),
  }) as Promise<{ suggestions: ReviewPoiSuggestion[] }>;
}

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

export async function uploadReviewVideo(file: File): Promise<{ path: string }> {
  const token = getToken();
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(apiUrl("/api/uploads/review-video"), {
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

export type AdvisorToolEvent = { type: "tool_start" | "tool_end"; name: string };

/** 流式调用 /api/ai/chat（SSE）：OpenAI 风格 delta.content；高德 Agent 另发 tool_start / tool_end。 */
export async function aiChatStream(
  messages: { role: "user" | "assistant"; content: string }[],
  onDelta: (chunk: string) => void,
  onToolEvent?: (ev: AdvisorToolEvent) => void,
): Promise<void> {
  const token = getToken();
  const res = await fetch(apiUrl("/api/ai/chat"), {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
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
          type?: string;
          name?: string;
          choices?: { delta?: { content?: string | null; reasoning_content?: string | null } }[];
        };
        if (j.type === "tool_start" || j.type === "tool_end") {
          if (typeof j.name === "string" && j.name.length > 0) {
            onToolEvent?.({ type: j.type, name: j.name });
          }
          continue;
        }
        const d = j.choices?.[0]?.delta;
        const piece = d?.content;
        if (typeof piece === "string" && piece.length > 0) {
          onDelta(piece);
          await yieldToBrowser();
        }
      } catch {
        /* 非 JSON 行或截断，忽略 */
      }
    }
  }
}
