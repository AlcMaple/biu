import cron from "node-cron";

import { config } from "./config.js";
import { pruneTombstones } from "./merge.js";
import { listUserMids, mutateEnvelope } from "./storage.js";
import { STORE_NAMES } from "./store-names.js";

/**
 * 每日清理超过保留期的墓碑，避免文件无限增长。顺序处理每个用户（不并发），
 * 这台机器内存紧张，批量并发遍历所有用户容易造成瞬时内存尖峰。
 */
export async function runTombstoneCleanup(): Promise<void> {
  const retentionMs = config.tombstoneRetentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const mids = await listUserMids();

  for (const mid of mids) {
    for (const store of STORE_NAMES) {
      try {
        await mutateEnvelope(mid, store, current => ({
          ...current,
          data: pruneTombstones(current.data, retentionMs, now),
        }));
      } catch (err) {
        console.error(`[cleanup] failed for mid=${mid} store=${store}`, err);
      }
    }
  }
}

export function scheduleTombstoneCleanup(): void {
  // 每天凌晨 3 点跑一次，避开使用高峰
  cron.schedule("0 3 * * *", () => {
    runTombstoneCleanup().catch(err => console.error("[cleanup] run failed", err));
  });
}
