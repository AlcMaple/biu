import platform, { log } from "@/platform";
import { StoreNameMap } from "@shared/store";

import type { FlatSnapshot, LiveSnapshot, SyncStoreName } from "./types";

import { getCurrentMid, pullSnapshot, pushOps } from "./client";
import { diffForMigration, diffSnapshots } from "./codec";
import { SYNC_DEBOUNCE_MS } from "./config";

async function readMeta(): Promise<PlaylistSyncMetaData> {
  return (await platform.getStore(StoreNameMap.PlaylistSyncMeta)) ?? {};
}

async function writeMeta(meta: PlaylistSyncMetaData): Promise<void> {
  await platform.setStore(StoreNameMap.PlaylistSyncMeta, meta);
}

export interface SyncBinding {
  store: SyncStoreName;
  /** 把当前 zustand store 状态编码成扁平快照，随时可调用，取的是"现在"的状态 */
  encodeNow: () => LiveSnapshot;
  /** 把服务端合并后的快照写回本地 zustand store（必须是"合并"语义，不能整体替换用户其他未参与同步的字段） */
  applyRemote: (flat: FlatSnapshot) => void;
}

/**
 * 单个 store 的同步控制器：防抖触发、首次迁移、增量 diff + 推送，一个实例对应一个
 * store（favorites / fav-items / tags），三者互相独立，一个失败不影响另外两个。
 */
export class StoreSyncController {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private pendingRerun = false;

  constructor(private binding: SyncBinding) {}

  scheduleSync(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runSync();
    }, SYNC_DEBOUNCE_MS);
  }

  private async runSync(): Promise<void> {
    if (this.running) {
      // 上一轮还没跑完又有新变更：记下来，这一轮跑完后再补跑一次，不丢变更
      this.pendingRerun = true;
      return;
    }
    this.running = true;
    try {
      await this.syncOnce();
    } catch (err) {
      log.warn(`[sync] ${this.binding.store} sync failed`, err);
    } finally {
      this.running = false;
      if (this.pendingRerun) {
        this.pendingRerun = false;
        void this.runSync();
      }
    }
  }

  private async syncOnce(): Promise<void> {
    const mid = await getCurrentMid();
    if (!mid) return; // 未登录，本地歌单同步依附登录态，跳过不算失败

    const meta = await readMeta();
    const userMeta = meta[mid] ?? { versions: {}, snapshots: {} };
    const hasSyncedBefore = userMeta.versions[this.binding.store] !== undefined;

    if (!hasSyncedBefore) {
      await this.migrate(mid, meta, userMeta);
      return;
    }

    const baseline = (userMeta.snapshots[this.binding.store] ?? {}) as FlatSnapshot;
    const localFlat = this.binding.encodeNow();
    const ops = diffSnapshots(baseline, localFlat, Date.now());
    if (ops.length === 0) return;

    const baseVersion = userMeta.versions[this.binding.store] ?? 0;
    const result = await pushOps(this.binding.store, baseVersion, ops);
    if (!result) return; // 网络/鉴权失败：静默放弃，不做轮询重试，等下次本地变更再触发

    this.binding.applyRemote(result.data);
    await this.persistMeta(mid, meta, userMeta, result.version, result.data);
  }

  /**
   * 首次同步：老用户设备上已经有一堆本地数据，云端可能是空的（这台设备第一次连）
   * 也可能已经有别的设备同步过的数据。两种情况都不能互相覆盖——本地数据要迁移上云，
   * 云端已有数据要合并进本地，谁都不能因为"对面没见过"就被当成删除。
   */
  private async migrate(
    mid: string,
    meta: PlaylistSyncMetaData,
    userMeta: PlaylistSyncMetaData[string],
  ): Promise<void> {
    const remote = await pullSnapshot(this.binding.store);
    if (!remote) return; // 拉取失败：绝不能在没见过云端数据的情况下就往上推，等下次重试

    const localFlat = this.binding.encodeNow();

    // 安全网：动手之前先把本地现状原样存一份，不进入任何合并计算路径。
    // 就算下面的合并/写回逻辑有 bug 把本地 store 搞坏了，这份快照也在磁盘上，
    // 能手动从 PlaylistSyncMeta 文件里把数据抄回来。只写一次，不随后续同步更新。
    if (!userMeta.preMigrationBackups?.[this.binding.store]) {
      const backedUpMeta: PlaylistSyncMetaData[string] = {
        ...userMeta,
        preMigrationBackups: { ...userMeta.preMigrationBackups, [this.binding.store]: localFlat },
      };
      await writeMeta({ ...meta, [mid]: backedUpMeta });
      userMeta = backedUpMeta;
    }

    const migrationOps = diffForMigration(remote.data, localFlat, Date.now());

    let finalEnvelope = remote;
    if (migrationOps.length > 0) {
      const pushed = await pushOps(this.binding.store, remote.version, migrationOps);
      if (!pushed) return; // 推送失败：不落地"已迁移"标记，下次启动会完整重试这套迁移流程
      finalEnvelope = pushed;
    }

    this.binding.applyRemote(finalEnvelope.data);
    await this.persistMeta(mid, meta, userMeta, finalEnvelope.version, finalEnvelope.data);
  }

  private async persistMeta(
    mid: string,
    meta: PlaylistSyncMetaData,
    userMeta: PlaylistSyncMetaData[string],
    version: number,
    snapshot: FlatSnapshot,
  ): Promise<void> {
    const nextUserMeta: PlaylistSyncMetaData[string] = {
      ...userMeta,
      versions: { ...userMeta.versions, [this.binding.store]: version },
      snapshots: { ...userMeta.snapshots, [this.binding.store]: snapshot },
    };
    await writeMeta({ ...meta, [mid]: nextUserMeta });
  }
}
