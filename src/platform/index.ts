import type { Logger, Platform } from "./types";

import { isElectron } from "./detect";

let platform: Platform;
let log: Logger;

if (isElectron) {
  const mod = await import("./electron");
  platform = mod.default;
  log = mod.log;
} else {
  const mod = await import("./android");
  platform = mod.default;
  log = mod.log;
}

export { log };
export * from "./detect";
export default platform;
