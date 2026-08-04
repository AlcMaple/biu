import platform, { log } from "@/platform";
import { StoreNameMap } from "@shared/store";

import type { FlatSnapshot, LiveSnapshot, SyncStoreName } from "./types";

import { pushLocalBackup } from "./backup";
import { getCurrentMid, pullSnapshot, pushOps } from "./client";
import { diffForMigration, diffSnapshots } from "./codec";
import { SYNC_DEBOUNCE_MS, SYNC_MAX_WAIT_MS, SYNC_META_EPOCH } from "./config";

/** 快照里还活着的条目数（墓碑不算） */
function liveCount(flat: FlatSnapshot): number {
  return Object.values(flat).filter(entry => !entry.__deleted).length;
}

async function readMeta(): Promise<PlaylistSyncMetaData> {
  return (await platform.getStore(StoreNameMap.PlaylistSyncMeta)) ?? {};
}

async function writeMeta(meta: PlaylistSyncMetaData): Promise<void> {
  await platform.setStore(StoreNameMap.PlaylistSyncMeta, meta);
}

export interface SyncBinding {
  store: SyncStoreName;
  /**
   * 等这个 store 的持久化数据 rehydrate 完成。
   *
   * ⚠️ 同步的一切都建立在"encodeNow 取到的是用户真实数据"之上。zustand persist 的
   * rehydrate 走 platform.getStore → IPC → 主进程读盘，是**异步**的；冷启动时主进程
   * 同时在建窗口/初始化，这条 IPC 排队超过防抖时长很正常。没等它就 encodeNow 会拿到
   * 初始空值，被 diff 解读成"用户删光了全部数据"，把云端和本地一起清空——这是真实
   * 发生过的事故，任何新增 binding 都必须实现这个方法，不能省。
   */
  waitReady: () => Promise<void>;
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
  /** 本轮防抖里第一次未处理变更的时间，用于计算是否已到最长等待上限 */
  private firstPendingAt: number | null = null;
  private running = false;
  private pendingRerun = false;
  /**
   * 本进程启动以来，是否**亲眼见过**这个 store 有内容。
   *
   * 这是区分"用户真的把东西删光了"和"状态没就绪所以看起来是空的"的关键信号：
   * 前者一定是「先有后无」——本次会话里先编码到过非空快照，用户再一条条删掉；
   * 后者是「一上来就是空的」，从没见过内容。事故当天正是后者。
   */
  private witnessedNonEmpty = false;

  constructor(private binding: SyncBinding) {}

  /**
   * 本地变更后排一次同步：防抖合并连续操作，但**带最长等待上限**。
   *
   * 纯防抖会被连续操作饿死（每次变更都重置计时器，用户手快时推送被无限顺延），
   * 所以记住第一次未处理变更的时间，超过 SYNC_MAX_WAIT_MS 就立刻推，不再等安静。
   */
  scheduleSync(): void {
    const now = Date.now();
    this.firstPendingAt ??= now;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    const waited = now - this.firstPendingAt;
    const delay = Math.max(0, Math.min(SYNC_DEBOUNCE_MS, SYNC_MAX_WAIT_MS - waited));

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.firstPendingAt = null;
      void this.runSync();
    }, delay);
  }

  /**
   * 立刻同步，不走防抖。
   *
   * 用于"被服务端通知别的设备改了"这类外部触发——那不是用户连续操作，没有需要合并的
   * 后续变更，再等一个防抖窗口纯属白白增加跨设备延迟（实测这一层就占了 800ms）。
   */
  syncNow(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.firstPendingAt = null;
    void this.runSync();
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

    // 必须在任何 encodeNow 之前：读盘没完成时的空状态不能进入 diff（见 SyncBinding.waitReady）
    await this.binding.waitReady();

    const meta = await readMeta();
    const userMeta = meta[mid] ?? { versions: {}, snapshots: {} };
    // 世代号对不上 = 从有已知缺陷的旧版本升上来，基线不可信：作废一次，走只增不删的迁移
    const baselineUsable = userMeta.epoch === SYNC_META_EPOCH;
    const hasSyncedBefore = baselineUsable && userMeta.versions[this.binding.store] !== undefined;

    if (!baselineUsable && userMeta.versions[this.binding.store] !== undefined) {
      log.warn(`[sync] ${this.binding.store} 基线世代号过期，本次走只增不删的迁移路径`);
    }

    if (!hasSyncedBefore) {
      await this.migrate(mid, meta, userMeta);
      return;
    }

    const baseline = (userMeta.snapshots[this.binding.store] ?? {}) as FlatSnapshot;
    const localFlat = this.binding.encodeNow();
    if (Object.keys(localFlat).length > 0) this.witnessedNonEmpty = true;

    // 闸门：本地空、基线不空 = "把这个 store 的全部内容删光"。
    // 只有在本次会话**从没见过这个 store 有内容**时才拦——那是"状态没就绪"的形态。
    // 用户真的删光（先有后无，witnessedNonEmpty 为 true）照常放行，否则删掉自己
    // 唯一的歌单会永远同步不出去。
    const isEmptyWipe = Object.keys(localFlat).length === 0 && liveCount(baseline) > 0;
    if (isEmptyWipe && !this.witnessedNonEmpty) {
      log.error(
        `[sync] ${this.binding.store} 本地快照为空但基线有 ${liveCount(baseline)} 条，且本次会话从未见过数据，已拒绝推送（疑似状态未就绪）`,
      );
      return;
    }

    const baseVersion = userMeta.versions[this.binding.store] ?? 0;

    // 先拉后推。**每次都要拉**：本机没有任何本地变更时，别的设备推上去的改动也必须能下来，
    // 否则同步是单向的——只推不拉，另一台设备的新增永远看不到（首次迁移之后就再没拉过，
    // 用户表现为"在另一台机器上等一天都不同步，重新登录才生效"，因为重登会重走迁移分支）。
    const remote = await pullSnapshot(this.binding.store);
    if (!remote) return; // 拉取失败：不在没看到云端现状的情况下贸然推送

    const ops = diffSnapshots(baseline, localFlat, Date.now());

    let envelope = remote;
    if (ops.length > 0) {
      // 推送前留一份本地现状：这是数据被意外清空后唯一能回溯到"最近状态"的地方
      await pushLocalBackup(mid, this.binding.store, localFlat);

      const pushed = await pushOps(this.binding.store, baseVersion, ops, isEmptyWipe);
      if (!pushed) return; // 网络/鉴权失败：静默放弃，不做轮询重试，等下次本地变更再触发
      envelope = pushed;
    } else if (remote.version === baseVersion) {
      return; // 两边都没动：不写回本地，避免 setState 触发订阅又排一轮同步，空转不停
    }

    this.binding.applyRemote(envelope.data);
    await this.persistMeta(mid, meta, userMeta, envelope.version, envelope.data);
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

    await pushLocalBackup(mid, this.binding.store, localFlat);

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
      epoch: SYNC_META_EPOCH,
      versions: { ...userMeta.versions, [this.binding.store]: version },
      snapshots: { ...userMeta.snapshots, [this.binding.store]: snapshot },
    };
    await writeMeta({ ...meta, [mid]: nextUserMeta });
  }
}
