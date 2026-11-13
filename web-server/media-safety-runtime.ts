import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { MediaSafetyPausedError, MediaSafetyStore } from "./media-safety-store.js";

export type MediaSafetyGate = Pick<MediaSafetyStore, "begin" | "finish" | "abandon">;

export function resolveMediaSafetyFile(
  mode: "production" | "development",
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  home = os.homedir(),
): string {
  const configured = environment.BIU_WEB_MEDIA_SAFETY_FILE;
  if (configured !== undefined) {
    if (!configured.trim() || configured === "memory")
      throw new Error("BIU_WEB_MEDIA_SAFETY_FILE requires a file path");
    return path.resolve(cwd, configured);
  }
  if (mode === "production") return path.join(home, ".biu-web", "media-safety.json");
  const checkout = createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 16);
  return path.join(home, ".biu-web", "dev-media-safety", checkout, "state.json");
}

export function createPersistentMediaSafetyGate(file: string): MediaSafetyGate {
  let store: MediaSafetyStore | undefined;
  let initializationFailed = false;
  const getStore = () => {
    if (initializationFailed) throw new MediaSafetyPausedError("storage");
    if (!store) {
      try {
        store = new MediaSafetyStore(file);
      } catch {
        // 损坏账本只关闭媒体；访问静态页或健康检查不能触发修复/重新出站。
        initializationFailed = true;
        throw new MediaSafetyPausedError("storage");
      }
    }
    return store;
  };
  return {
    begin: () => getStore().begin(),
    abandon: id => getStore().abandon(id),
    finish: (id, status, riskControl) => getStore().finish(id, status, riskControl),
  };
}
