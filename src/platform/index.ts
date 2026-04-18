import type { Logger, Platform, PlatformHttp } from "./types";

import androidPlatform, { log as androidLog } from "./android";
import { isElectron } from "./detect";
import electronPlatform, { log as electronLog } from "./electron";
import electronHttp from "./http-electron";

const platform: Platform = isElectron ? electronPlatform : androidPlatform;
const log: Logger = isElectron ? electronLog : androidLog;

// Android 端的 http 延迟到真正用到时再加载，避免在 Electron 里拉入 @capacitor/core
let http: PlatformHttp;
if (isElectron) {
  http = electronHttp;
} else {
  http = {
    async request(config) {
      const mod = await import("./http-android");
      return mod.default.request(config);
    },
  };
}

export { http, log };
export * from "./detect";
export default platform;
