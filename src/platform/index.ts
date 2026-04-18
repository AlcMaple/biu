import type { Logger, Platform, PlatformHttp } from "./types";

import { isElectron } from "./detect";

let platform: Platform;
let log: Logger;
let http: PlatformHttp;

if (isElectron) {
  const [platformMod, httpMod] = await Promise.all([import("./electron"), import("./http-electron")]);
  platform = platformMod.default;
  log = platformMod.log;
  http = httpMod.default;
} else {
  const [platformMod, httpMod] = await Promise.all([import("./android"), import("./http-android")]);
  platform = platformMod.default;
  log = platformMod.log;
  http = httpMod.default;
}

export { http, log };
export * from "./detect";
export default platform;
