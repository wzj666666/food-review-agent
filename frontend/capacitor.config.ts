import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dianping.personal",
  appName: "个人点评",
  webDir: "../static",
  server: {
    url: "http://127.0.0.1:5255",
    cleartext: true,
  },
};

export default config;
