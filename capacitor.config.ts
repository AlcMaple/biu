import type { CapacitorConfig } from "@capacitor/cli";

// 仅在设置 BIU_DEV_URL 时启用 Live Reload，指向本机 Rsbuild dev server。
// 留空时走默认离线包行为，生产构建 (pnpm build:android) 不受影响。
const devUrl = process.env.BIU_DEV_URL;

const config: CapacitorConfig = {
  appId: "com.biu.app",
  appName: "Biu",
  webDir: "dist/web",
  server: devUrl ? { androidScheme: "https", url: devUrl, cleartext: true } : { androidScheme: "https" },
};

export default config;
