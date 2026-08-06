import platform, { log } from "@/platform";
import { StoreNameMap } from "@shared/store";

import type { Envelope, FlatSnapshot, LiveSnapshot, SyncStoreName } from "./types";

import { pushLocalBackup } from "./backup";
import { getCurrentMid, pullSnapshot, pushOps } from "./client";
import { diffForMigration, diffSnapshots } from "./codec";
import { SYNC_DEBOUNCE_MS, SYNC_MAX_WAIT_MS, SYNC_META_EPOCH, SYNC_RETRY_DELAY_MS, SYNC_SLOW_LOG_MS } from "./config";

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
  /** 本轮失败是否已经补过一次重试，防止失败时无限重试打请求 */
  private retriedOnce = false;
  /**
   * 本进程启动以来，是否**亲眼见过**这个 store 有内容。
   *
   * 这是区分"用户真的把东西删光了"和"状态没就绪所以看起来是空的"的关键信号：
   * 前者一定是「先有后无」——本次会话里先编码到过非空快照，用户再一条条删掉；
   * 后者是「一上来就是空的」，从没见过内容。事故当天正是后者。
   */
  private witnessedNonEmpty = false;

  /**
   * 正在把服务端数据写回本地 store。
   *
   * `applyRemote` 会 setState，而 setState 会触发 store 订阅 → 再排一轮同步。但这轮
   * 数据本来就是刚从服务端拿的，再同步一次纯属空转，且**每次变更都会翻倍请求量**——
   * 两台设备加起来很容易撞满服务端限流（真实事故：一次操作打十几个请求，连做几次
   * 全部 429，表现为"同步很久不动"）。订阅回调据此跳过。
   */
  private applyingRemote = false;

  /**
   * 通知通道告知的云端版本号（`null` = 不知道）。
   *
   * 有了它，"本机没变更"的那轮同步就能直接判断要不要拉，不必为了确认云端状态再多打一个
   * 请求；同时也能识破"自己推送把自己叫醒"——那个版本号就是本机刚推上去的，无需再拉。
   */
  private remoteVersionHint: number | null = null;

  /** 本机最近一次成功同步到的版本，用来跳过自己造成的通知回声 */
  private lastSyncedVersion = -1;

  constructor(private binding: SyncBinding) {}

  /**
   * 这个版本号本机是否已经同步过了。
   *
   * 自己推送成功后服务端会广播变更，本机挂着的通知通道会被自己叫醒一次——那条通知
   * 携带的正是本机刚写上去的版本号，再同步一轮纯属多打一个请求。
   */
  hasSynced(version: number): boolean {
    return this.lastSyncedVersion >= version;
  }

  /** 这个控制器负责的 store，供外部按"哪个 store 真的变了"精确触发 */
  get storeName(): SyncStoreName {
    return this.binding.store;
  }

  isApplyingRemote(): boolean {
    return this.applyingRemote;
  }

  /** 写回本地时屏蔽自身订阅触发的同步，避免每次变更请求量翻倍 */
  private applyRemote(flat: FlatSnapshot): void {
    this.applyingRemote = true;
    try {
      this.binding.applyRemote(flat);
    } finally {
      this.applyingRemote = false;
    }
  }

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
      // 本地变更触发的这轮没有云端版本信息，清掉上一次通知留下的，避免据此误判"不用拉"
      this.remoteVersionHint = null;
      void this.runSync();
    }, delay);
  }

  /**
   * 立刻同步，不走防抖。
   *
   * 用于"被服务端通知别的设备改了"这类外部触发——那不是用户连续操作，没有需要合并的
   * 后续变更，再等一个防抖窗口纯属白白增加跨设备延迟（实测这一层就占了 800ms）。
   */
  syncNow(remoteVersionHint: number | null = null): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.firstPendingAt = null;
    this.remoteVersionHint = remoteVersionHint;
    void this.runSync();
  }

  private async runSync(): Promise<void> {
    if (this.running) {
      // 上一轮还没跑完又有新变更：记下来，这一轮跑完后再补跑一次，不丢变更
      this.pendingRerun = true;
      return;
    }
    this.running = true;

    const startedAt = Date.now();
    let ok = false;
    try {
      ok = await this.syncOnce();
    } catch (err) {
      log.warn(`[sync] ${this.binding.store} sync failed`, err);
    } finally {
      this.running = false;

      // 慢同步要留痕：正常一轮是几百毫秒，明显超出说明请求在排队或网络有问题，
      // 没有这行日志就只能靠用户描述"感觉很慢"来猜。
      const elapsed = Date.now() - startedAt;
      if (elapsed > SYNC_SLOW_LOG_MS) {
        log.warn(`[sync] ${this.binding.store} 本轮耗时 ${elapsed}ms（正常应在 1s 内）`);
      }

      if (this.pendingRerun) {
        this.pendingRerun = false;
        void this.runSync();
      } else if (!ok && !this.retriedOnce) {
        // 传输层失败（超时/断网）补一次，且只补一次：本地变更此刻还没上云，
        // 不重试的话要等到用户下次操作才会再推，中间这段时间另一台设备看不到。
        // 单次重试是 AI_GUIDELINES 允许的"瞬时抖动"范畴，不是失败轮询。
        this.retriedOnce = true;
        setTimeout(() => void this.runSync(), SYNC_RETRY_DELAY_MS);
      } else {
        this.retriedOnce = false;
      }
    }
  }

  /** @returns false 表示传输层失败（拉取/推送没成功），调用方据此决定要不要补一次重试 */
  private async syncOnce(): Promise<boolean> {
    const mid = await getCurrentMid();
    if (!mid) return true; // 未登录，本地歌单同步依附登录态，跳过不算失败

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
      return this.migrate(mid, meta, userMeta);
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
      return true; // 主动拒绝，不是传输失败，重试也没用
    }

    const baseVersion = userMeta.versions[this.binding.store] ?? 0;
    const ops = diffSnapshots(baseline, localFlat, Date.now());

    // 一轮同步**最多只发一个请求**，三种情况互斥：
    //
    // 1. 有本地变更 → 只 push。推送的响应本身就返回合并后的完整快照（含别的设备的改动），
    //    所以推之前那次 pull 是纯浪费——服务端的合并是按条目做的，不需要客户端先看一眼。
    // 2. 无本地变更、但云端版本比基线新 → 只 pull。
    // 3. 两边都没动 → 一个请求都不发。
    //
    // 请求数直接决定能撑多少用户：接口只有 3 个，但请求数 = 接口 × store × 设备 × 触发次数，
    // 放大得很快（真实事故：一次操作曾打出约 17 个请求，几次操作就打满限流）。
    let envelope: Envelope;

    if (ops.length > 0) {
      // 推送前留一份本地现状：这是数据被意外清空后唯一能回溯到"最近状态"的地方
      await pushLocalBackup(mid, this.binding.store, localFlat);

      const pushed = await pushOps(this.binding.store, baseVersion, ops, isEmptyWipe);
      if (!pushed) return false; // 网络/鉴权失败：由 runSync 补一次重试
      envelope = pushed;
    } else {
      // 没有本地变更时才需要判断"要不要拉"。remoteVersionHint 来自通知通道返回的版本号，
      // 有它就不必为了确认"云端有没有变"再多打一个请求；没有它（登录/focus 触发）才盲拉一次。
      if (this.remoteVersionHint !== null && this.remoteVersionHint <= baseVersion) {
        return true; // 云端不比基线新，无事可做
      }
      const pulled = await pullSnapshot(this.binding.store);
      if (!pulled) return false;
      if (pulled.version === baseVersion) return true; // 两边都没动，不写回本地，避免空转
      envelope = pulled;
    }

    this.applyRemote(envelope.data);
    await this.persistMeta(mid, meta, userMeta, envelope.version, envelope.data);
    return true;
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
  ): Promise<boolean> {
    const remote = await pullSnapshot(this.binding.store);
    if (!remote) return false; // 拉取失败：绝不能在没见过云端数据的情况下就往上推

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
      if (!pushed) return false; // 推送失败：不落地"已迁移"标记，下次会完整重试这套迁移流程
      finalEnvelope = pushed;
    }

    this.applyRemote(finalEnvelope.data);
    await this.persistMeta(mid, meta, userMeta, finalEnvelope.version, finalEnvelope.data);
    return true;
  }

  private async persistMeta(
    mid: string,
    meta: PlaylistSyncMetaData,
    userMeta: PlaylistSyncMetaData[string],
    version: number,
    snapshot: FlatSnapshot,
  ): Promise<void> {
    this.lastSyncedVersion = version;
    const nextUserMeta: PlaylistSyncMetaData[string] = {
      ...userMeta,
      epoch: SYNC_META_EPOCH,
      versions: { ...userMeta.versions, [this.binding.store]: version },
      snapshots: { ...userMeta.snapshots, [this.binding.store]: snapshot },
    };
    await writeMeta({ ...meta, [mid]: nextUserMeta });
  }
}
