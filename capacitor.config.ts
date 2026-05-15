import type { CapacitorConfig } from "@capacitor/cli";

// 仅在设置 BIU_DEV_URL 时启用 Live Reload，指向本机 Rsbuild dev server。
// 留空时走默认离线包行为，生产构建 (pnpm build:android) 不受影响。
const devUrl = process.env.BIU_DEV_URL;

const config: CapacitorConfig = {
  appId: "com.biu.app",
  appName: "Biu",
  webDir: "dist/web",
  server: devUrl ? { androidScheme: "https", url: devUrl, cleartext: true } : { androidScheme: "https" },
  plugins: {
    // CapacitorHttp 已被 http-android.ts 直接调用；这里启用是为了让其同时
    // patch 全局 fetch/XHR，确保第三方库的请求也走原生通道（绕过 WebView CORS）
    CapacitorHttp: { enabled: true },
    // 启用原生 cookie 桥接：让 platform.getCookie/setCookie 可读写 WebView 的
    // 系统 cookie jar（B 站登录态持久化、refreshCookie 流程依赖）
    CapacitorCookies: { enabled: true },
  },
};

export default config;
