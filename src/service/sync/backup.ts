/**
 * 同步推送前的本地滚动备份。
 *
 * Why: `preMigrationBackups` 只在首次迁移时写一次，之后永不更新——一旦同步逻辑
 * 把数据清空，能找回的只是首次同步那天的状态，那之后新增的全部丢失（已发生过一次
 * 真实事故）。这里在**每次推送之前**留一份本地现状，保留最近若干份，把那段窗口补上。
 * 纯设备本地数据，不参与任何同步计算，也不上云。
 */
import platform, { log } from "@/platform";
import { StoreNameMap } from "@shared/store";

import type { LiveSnapshot, SyncStoreName } from "./types";

import { SYNC_BACKUP_KEEP } from "./config";

/**
 * 把某个 store 的当前本地快照压入备份队列（最新在前，超出保留数的丢弃）。
 *
 * 与上一份内容相同时跳过，避免每次启动的空跑把有价值的历史挤出保留窗口。
 * 备份失败绝不能阻断同步本身，调用方无需处理异常。
 */
export async function pushLocalBackup(mid: string, store: SyncStoreName, snapshot: LiveSnapshot): Promise<void> {
  try {
    const all = ((await platform.getStore(StoreNameMap.PlaylistSyncBackups)) ?? {}) as PlaylistSyncBackupsData;
    const userBackups = all[mid] ?? {};
    const queue = userBackups[store] ?? [];

    if (queue[0] && JSON.stringify(queue[0].snapshot) === JSON.stringify(snapshot)) return;

    const next = [{ at: Date.now(), snapshot }, ...queue].slice(0, SYNC_BACKUP_KEEP);
    await platform.setStore(StoreNameMap.PlaylistSyncBackups, {
      ...all,
      [mid]: { ...userBackups, [store]: next },
    });
  } catch (err) {
    log.warn(`[sync] ${store} local backup failed`, err);
  }
}
