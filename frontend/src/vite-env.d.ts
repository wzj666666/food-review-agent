/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 仅「内置 static、无 server.url」的 APK 需要，例如 http://192.168.1.5:5255 */
  readonly VITE_API_ORIGIN?: string;
}
