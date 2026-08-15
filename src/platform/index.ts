import type { Logger, Platform, PlatformHttp } from "./types";

import { isElectron, isNativeMobile } from "./detect";
import electronPlatform, { log as electronLog } from "./electron";
import electronHttp from "./http-electron";
import mobilePlatform, { log as mobileLog } from "./mobile";
import webPlatform, { log as webLog } from "./web";

const platform: Platform = isElectron ? electronPlatform : isNativeMobile ? mobilePlatform : webPlatform;
const log: Logger = isElectron ? electronLog : isNativeMobile ? mobileLog : webLog;

// 只有 Capacitor 原生移动端使用 native HTTP；Electron 和普通 Web 都走浏览器 axios。
let http: PlatformHttp;
if (isNativeMobile) {
  http = {
    async request(config) {
      const mod = await import("./http-native");
      return mod.default.request(config);
    },
  };
} else {
  http = electronHttp;
}

export { http, log };
export * from "./detect";
export default platform;
