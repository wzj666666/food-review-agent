import type { CapacitorConfig } from "@capacitor/cli";

/**
 * 两种用法（二选一）：
 *
 * 1) 远程整站（推荐）：配置 server.url 为可访问的站点根（公网或局域网均可）。
 *    后端需 `uvicorn ... --host 0.0.0.0 --port 5255`，云主机安全组放行 5255。
 *    前端用相对路径调 /api，不必设 VITE_API_ORIGIN。
 *
 * 2) 内置 static：注释掉 server，先 `npm run build`，再打 APK 前设
 *    VITE_API_ORIGIN=http://你的主机:5255（可用 .env.production.local）
 */
const config: CapacitorConfig = {
  appId: "com.dianping.personal",
  appName: "个人点评",
  webDir: "../static",
  server: {
    url: "http://39.105.182.86:5255",
    cleartext: true,
  },
};

export default config;
