import { create } from "zustand";

import { isTestAccount } from "@/common/constants/test-account";
import { isOfflineDemo } from "@/common/offline-demo";
import platform, { log } from "@/platform";
import { fetchCloudRanking, pushRankingEvents } from "@/service/sync/client";
import { useUser } from "@/store/user";
import { nextRankingBatch, RANKING_WEEK_MS, type CloudRanking, type RankingLocalState } from "@shared/play-ranking";

import type { PlayData } from "./play-list";

export interface PlayRankingItem extends PlayCountRecord {
  periodCount: number;
}

interface RankingView {
  mid: string | null;
  records: PlayCountsData;
  pending: number;
  unassigned: number;
  loading: boolean;
  updatedAt?: number;
  error?: string;
}

export const usePlayRankingState = create<RankingView>()(() => ({
  mid: null,
  records: {},
  pending: 0,
  unassigned: 0,
  loading: false,
}));

const currentMid = () => {
  const mid = useUser.getState().user?.mid;
  return mid ? String(mid) : null;
};

function showLocal(state: RankingLocalState, mid: string | null) {
  if (currentMid() !== mid) return;
  const account = mid ? state.accounts[mid] : undefined;
  usePlayRankingState.setState({
    mid,
    records: mid ? (account?.cloud?.records ?? {}) : state.unassigned,
    pending: account?.pending.reduce((sum, event) => sum + event.record.totalCount, 0) ?? 0,
    unassigned: Object.values(state.unassigned).reduce((sum, record) => sum + (record.totalCount || 0), 0),
    updatedAt: account?.cloud?.updatedAt,
  });
}

async function waitForUser() {
  if (useUser.persist.hasHydrated()) return;
  await new Promise<void>(resolve => {
    const unsubscribe = useUser.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

function describeFailure(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { error?: string } } })?.response;
  if (response?.status === 429) return "同步请求受限，记录已保存在本机，请稍后再打开本页或重新登录";
  if (response?.status === 404) return "云端尚未启用听歌排行，请先更新同步服务和 Web 服务";
  if (response?.status === 401) return "登录状态已失效，请重新登录；待同步记录已保留";
  return response?.data?.error || (error instanceof Error ? error.message : "同步失败，待同步记录已保留");
}

let generation = 0;
let running: Promise<void> | undefined;
let rerun = false;
let rerunVersion: number | undefined;
let blocked = false;
let scheduled: ReturnType<typeof setTimeout> | undefined;

export function resetPlayRankingSession() {
  generation += 1;
  blocked = false;
  rerun = false;
  rerunVersion = undefined;
  if (scheduled) clearTimeout(scheduled);
  scheduled = undefined;
  usePlayRankingState.setState({
    mid: currentMid(),
    records: {},
    pending: 0,
    unassigned: 0,
    updatedAt: undefined,
    error: undefined,
    loading: false,
  });
}

function assertSnapshot(
  snapshot: CloudRanking | null,
  mid: string,
  knownVersion: number,
): asserts snapshot is CloudRanking {
  if (!snapshot) throw new Error("登录状态暂不可用，待同步记录已保留");
  if (snapshot.mid !== mid) throw new Error("账号已变化，原账号记录已保留");
  if (
    !Number.isSafeInteger(snapshot.version) ||
    !snapshot.records ||
    typeof snapshot.records !== "object" ||
    Array.isArray(snapshot.records)
  ) {
    throw new Error("云端排行响应异常，原记录已保留");
  }
  if (snapshot.version < knownVersion) throw new Error("云端排行版本回退，请核对云端备份；本机缓存和待同步记录已保留");
}

export async function syncPlayRanking(remoteVersion?: number, resume = false): Promise<void> {
  if (isOfflineDemo) return;
  if (resume) blocked = false;
  if (blocked) return;
  if (running) {
    // 自己推送引起的通知保留版本号，确认落盘后可直接识别为回声。
    rerunVersion = !rerun
      ? remoteVersion
      : rerunVersion === undefined || remoteVersion === undefined
        ? undefined
        : Math.max(rerunVersion, remoteVersion);
    rerun = true;
    return running;
  }
  const taskGeneration = generation;
  const task = async () => {
    await waitForUser();
    const mid = currentMid();
    const isCurrent = () => taskGeneration === generation && currentMid() === mid;
    try {
      let state = await platform.rankingLocal({ kind: "read" });
      if (!isCurrent()) return;
      showLocal(state, mid);
      // 测试账号没有云端会话，不归入未登录记录，也不发同步请求
      if (!mid || isTestAccount(useUser.getState().user)) return;
      if (Object.keys(state.unassigned).length) {
        // 旧记录和未登录期间的播放没有账号归属；登录即归入当前账号，不再要求手动确认。
        state = await platform.rankingLocal({ kind: "import", mid });
        if (!isCurrent()) return;
      }
      let account = state.accounts[mid];
      if (remoteVersion !== undefined && (account?.cloud?.version ?? -1) >= remoteVersion && !account?.pending.length)
        return;
      usePlayRankingState.setState({ loading: true, error: undefined });
      if (!account?.pending.length) {
        const snapshot = await fetchCloudRanking(mid);
        if (!isCurrent()) return;
        assertSnapshot(snapshot, mid, account?.cloud?.version ?? 0);
        state = await platform.rankingLocal({ kind: "ack", mid, snapshot });
      } else {
        // 每批确认后再读本机队列；网络等待期间新增的记录不会被旧响应覆盖。
        while (account?.pending.length && isCurrent()) {
          const batch = nextRankingBatch(account.pending);
          const snapshot = await pushRankingEvents(mid, state.deviceId, batch);
          if (!isCurrent()) return;
          assertSnapshot(snapshot, mid, account.cloud?.version ?? 0);
          if (snapshot.ackSeq === undefined || snapshot.ackSeq < batch.at(-1)!.seq)
            throw new Error("云端尚未确认本批记录，待同步记录已保留");
          state = await platform.rankingLocal({ kind: "ack", mid, snapshot });
          account = state.accounts[mid];
        }
      }
      if (isCurrent()) showLocal(state, mid);
    } catch (err) {
      log.warn("[ranking] 同步失败，停止自动请求", { message: describeFailure(err) });
      if (isCurrent()) {
        blocked = true;
        rerun = false;
        usePlayRankingState.setState({ error: describeFailure(err) });
      }
    } finally {
      if (isCurrent()) usePlayRankingState.setState({ loading: false });
    }
  };
  running = task().finally(() => {
    running = undefined;
    if (rerun && !blocked) {
      const hint = rerunVersion;
      rerun = false;
      rerunVersion = undefined;
      void syncPlayRanking(hint);
    }
  });
  return running;
}

export async function recordPlayCount(item: PlayData): Promise<void> {
  if (isOfflineDemo || !item) return;
  const capturedMid = useUser.persist.hasHydrated() ? currentMid() : undefined;
  await waitForUser();
  const mid = capturedMid === undefined ? currentMid() : capturedMid;
  const id = item.bvid || (item.sid != null ? String(item.sid) : "") || item.id;
  if (!id) return;
  const now = Date.now();
  try {
    const state = await platform.rankingLocal({
      kind: "record",
      mid,
      record: {
        key: `${item.source || "online"}:${id}:${item.cid || ""}`,
        title: item.pageTitle || item.title,
        cover: item.pageCover || item.cover,
        ownerName: item.ownerName,
        ownerMid: item.ownerMid,
        bvid: item.bvid,
        isLossless: item.isLossless,
        isDolby: item.isDolby,
        totalCount: 1,
        recentPlays: [now],
      },
    });
    showLocal(state, mid);
    if (!mid || currentMid() !== mid || blocked || scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = undefined;
      void syncPlayRanking();
    }, 400);
  } catch (err) {
    log.error("[ranking] 本机记录保存失败", err);
    if (currentMid() === mid) usePlayRankingState.setState({ error: "本次听歌记录保存失败，请检查设备存储" });
  }
}

export function rankingItems(records: PlayCountsData, period: "week" | "all", now = Date.now()): PlayRankingItem[] {
  return Object.values(records)
    .map(record => ({
      ...record,
      periodCount:
        period === "all"
          ? record.totalCount
          : record.recentPlays.filter(t => t > now - RANKING_WEEK_MS && t <= now).length,
    }))
    .filter(item => item.periodCount > 0)
    .sort((a, b) => b.periodCount - a.periodCount || a.key.localeCompare(b.key));
}

export async function getPlayRanking(period: "week" | "all"): Promise<PlayRankingItem[]> {
  await syncPlayRanking();
  const view = usePlayRankingState.getState();
  return view.mid === currentMid() ? rankingItems(view.records, period) : [];
}
