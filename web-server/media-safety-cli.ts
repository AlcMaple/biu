import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveMediaSafetyFile } from "./media-safety-runtime.js";
import { MediaSafetyStore, parseMediaSafetyRecord, type MediaSafetyRecord } from "./media-safety-store.js";

export function runMediaSafetyCommand(args: string[], environment: NodeJS.ProcessEnv = process.env) {
  const [command, ...rest] = args;
  if (command !== "status" && command !== "resume") throw new Error("Use status or resume");
  const options = new Map<string, string>();
  let development = false;
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (key === "--dev" && !development) {
      development = true;
      continue;
    }
    if (!["--file", "--revision", "--confirm"].includes(key) || options.has(key))
      throw new Error("Invalid or duplicate option");
    const value = rest[++i];
    if (!value || value.startsWith("--")) throw new Error("Missing option value");
    options.set(key, value);
  }
  if (command === "status" && (options.has("--revision") || options.has("--confirm")))
    throw new Error("status does not accept recovery options");
  const file = resolveMediaSafetyFile(development ? "development" : "production", {
    ...environment,
    ...(options.has("--file") ? { BIU_WEB_MEDIA_SAFETY_FILE: options.get("--file") } : {}),
  });
  let record: MediaSafetyRecord;
  try {
    record = parseMediaSafetyRecord(readFileSync(file, "utf8"));
  } catch (error) {
    if (command === "status" && (error as NodeJS.ErrnoException).code === "ENOENT")
      return { file, initialized: false as const };
    throw error;
  }
  if (command === "resume") {
    const rawRevision = options.get("--revision");
    if (!rawRevision || !/^\d+$/.test(rawRevision) || !Number.isSafeInteger(Number(rawRevision)))
      throw new Error("A current integer --revision is required");
    if (options.get("--confirm") !== "resume-media") throw new Error("Explicit --confirm resume-media is required");
    record = new MediaSafetyStore(file, { initialize: false }).resume(Number(rawRevision));
  }
  return {
    file,
    initialized: true as const,
    revision: record.revision,
    reason: record.reason,
    pendingCount: record.pending.length,
    pausedOrUnconfirmed: Boolean(record.reason || record.pending.length),
    resumed: command === "resume",
    ...(command === "resume" ? { restartAfterStorageFailure: true } : {}),
  };
}

function isCommandEntry() {
  if (!process.argv[1]) return false;
  try {
    // 发布目录可能由 current 符号链接进入，不能因此静默跳过命令。
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isCommandEntry()) {
  try {
    console.info(JSON.stringify(runMediaSafetyCommand(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Media safety operation failed");
    process.exitCode = 1;
  }
}
