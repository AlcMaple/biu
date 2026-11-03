import type { Logger, Platform, PlatformHttp } from "./types";

import { isElectron } from "./detect";
import electronPlatform, { log as electronLog } from "./electron";
import electronHttp from "./http-electron";
import { markPlatformReady } from "./ready";
import webPlatform, { log as webLog } from "./web";

const platform: Platform = isElectron ? electronPlatform : webPlatform;
markPlatformReady(platform);
const log: Logger = isElectron ? electronLog : webLog;

const http: PlatformHttp = electronHttp;

export { http, log };
export * from "./detect";
export default platform;
