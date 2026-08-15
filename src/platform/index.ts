import type { Logger, Platform, PlatformHttp } from "./types";

import androidPlatform, { log as androidLog } from "./android";
import { isAndroid, isElectron } from "./detect";
import electronPlatform, { log as electronLog } from "./electron";
import electronHttp from "./http-electron";
import webPlatform, { log as webLog } from "./web";

const platform: Platform = isElectron ? electronPlatform : isAndroid ? androidPlatform : webPlatform;
const log: Logger = isElectron ? electronLog : isAndroid ? androidLog : webLog;

// 只有 Capacitor Android 使用原生 HTTP adapter；Electron 和普通 Web 都走浏览器 axios。
let http: PlatformHttp;
if (isAndroid) {
  http = {
    async request(config) {
      const mod = await import("./http-android");
      return mod.default.request(config);
    },
  };
} else {
  http = electronHttp;
}

export { http, log };
export * from "./detect";
export default platform;
