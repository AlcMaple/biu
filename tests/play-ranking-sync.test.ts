import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateRankingLocal, type RankingLocalState, type RankingLocalAction } from "@shared/play-ranking";

const mocks = vi.hoisted(() => ({
  mid: 42 as number | null,
  hydrated: true,
  finishHydration: undefined as (() => void) | undefined,
  rankingLocal: vi.fn<(action: RankingLocalAction) => Promise<RankingLocalState>>(),
  fetch: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/common/offline-demo", () => ({ isOfflineDemo: false }));
vi.mock("@/platform", () => ({
  default: { rankingLocal: mocks.rankingLocal },
  log: { warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/service/sync/client", () => ({ fetchCloudRanking: mocks.fetch, pushRankingEvents: mocks.push }));
vi.mock("@/store/user", () => ({
  useUser: {
    getState: () => ({ user: mocks.mid ? { mid: mocks.mid } : null }),
    persist: {
      hasHydrated: () => mocks.hydrated,
      onFinishHydration: (cb: () => void) => {
        mocks.finishHydration = cb;
        return () => {};
      },
    },
  },
}));

let state: RankingLocalState;
const item = { id: "song", bvid: "BV1234567890", cid: "12", type: "mv" as const, title: "测试歌曲" };
const snapshot = (mid = "42", version = 1, ackSeq?: number) => ({
  mid,
  version,
  updatedAt: 100,
  records: {},
  ...(ackSeq !== undefined ? { ackSeq } : {}),
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.mid = 42;
  mocks.hydrated = true;
  state = updateRankingLocal(undefined, undefined, { kind: "read" });
  mocks.rankingLocal.mockImplementation(async action => {
    state = updateRankingLocal(state, undefined, action);
    return structuredClone(state);
  });
  mocks.fetch.mockResolvedValue(snapshot());
  mocks.push.mockImplementation(async (mid, _device, events) => snapshot(mid, 1, events.at(-1).seq));
});
afterEach(() => vi.useRealTimers());

describe("云端排行客户端", () => {
  it("本机无变更也读取云端", async () => {
    const ranking = await import("@/store/play-ranking");
    await ranking.syncPlayRanking();
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("42");
    expect(state.accounts["42"].cloud?.version).toBe(1);
  });

  it("先落盘再上报，成功后清除已确认队列", async () => {
    const ranking = await import("@/store/play-ranking");
    await ranking.recordPlayCount(item);
    expect(state.accounts["42"].pending).toHaveLength(1);
    expect(mocks.push).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(state.accounts["42"].pending).toHaveLength(0);
  });

  it("上报期间的新播放不会丢失", async () => {
    const ranking = await import("@/store/play-ranking");
    await ranking.recordPlayCount(item);
    const delayed = deferred<ReturnType<typeof snapshot>>();
    mocks.push.mockReturnValueOnce(delayed.promise);
    const syncing = ranking.syncPlayRanking();
    await vi.advanceTimersByTimeAsync(0);
    await ranking.recordPlayCount(item);
    delayed.resolve(snapshot("42", 1, 1));
    await syncing;
    expect(mocks.push.mock.calls.map(call => call[2].map(event => event.seq))).toEqual([[1], [2]]);
    expect(state.accounts["42"].pending).toEqual([]);
  });

  it.each([429, 503])("%s 后保留队列，前台事件和新播放不自动重试", async status => {
    const ranking = await import("@/store/play-ranking");
    mocks.push.mockRejectedValue({ response: { status } });
    await ranking.recordPlayCount(item);
    await ranking.syncPlayRanking();
    await ranking.recordPlayCount(item);
    await vi.advanceTimersByTimeAsync(60000);
    await ranking.syncPlayRanking();
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(state.accounts["42"].pending).toHaveLength(2);
    expect(ranking.usePlayRankingState.getState().error).toBeTruthy();
    mocks.push.mockResolvedValue(snapshot("42", 1, 2));
    await ranking.syncPlayRanking(undefined, true);
    expect(state.accounts["42"].pending).toEqual([]);
  });

  it("读取旧账号的慢响应不显示到新账号", async () => {
    const ranking = await import("@/store/play-ranking");
    const delayed = deferred<ReturnType<typeof snapshot>>();
    mocks.fetch.mockReturnValueOnce(delayed.promise);
    const syncing = ranking.syncPlayRanking();
    await vi.advanceTimersByTimeAsync(0);
    mocks.mid = 99;
    ranking.resetPlayRankingSession();
    delayed.resolve(snapshot("42"));
    await syncing;
    expect(ranking.usePlayRankingState.getState().mid).toBe("99");
    expect(state.accounts["99"]).toBeUndefined();
    expect(ranking.usePlayRankingState.getState().records).toEqual({});
  });

  it("账号切换期间保存的播放仍归播放发生时的账号", async () => {
    const ranking = await import("@/store/play-ranking");
    const recorded = ranking.recordPlayCount(item);
    mocks.mid = 99;
    ranking.resetPlayRankingSession();
    await recorded;
    expect(state.accounts["42"].pending).toHaveLength(1);
    expect(state.accounts["99"]).toBeUndefined();
  });

  it("身份未完成 rehydrate 前不读取或上传空状态", async () => {
    const ranking = await import("@/store/play-ranking");
    mocks.hydrated = false;
    const syncing = ranking.syncPlayRanking();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.rankingLocal).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.hydrated = true;
    mocks.finishHydration?.();
    await syncing;
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("已同步版本的通知回声不产生新请求", async () => {
    const ranking = await import("@/store/play-ranking");
    await ranking.syncPlayRanking();
    await ranking.syncPlayRanking(1);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("云端恢复旧快照时明确提示版本回退，不把旧结果标成已同步", async () => {
    const ranking = await import("@/store/play-ranking");
    mocks.fetch.mockResolvedValueOnce(snapshot("42", 5)).mockResolvedValueOnce(snapshot("42", 2));
    await ranking.syncPlayRanking();
    await ranking.syncPlayRanking();
    expect(state.accounts["42"].cloud?.version).toBe(5);
    expect(ranking.usePlayRankingState.getState().error).toContain("版本回退");
  });

  it("未登录只记本机，登录后自动归入当时登录的账号", async () => {
    const ranking = await import("@/store/play-ranking");
    mocks.mid = null;
    await ranking.recordPlayCount(item);
    await ranking.syncPlayRanking();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(Object.keys(state.unassigned)).toHaveLength(1);
    mocks.mid = 99;
    await ranking.syncPlayRanking();
    expect(mocks.push.mock.calls[0][0]).toBe("99");
    expect(state.unassigned).toEqual({});
  });

  it("本机存储错误显示出来，不冒充已同步", async () => {
    const ranking = await import("@/store/play-ranking");
    mocks.rankingLocal.mockRejectedValueOnce(new Error("disk full"));
    await ranking.recordPlayCount(item);
    expect(ranking.usePlayRankingState.getState().error).toContain("保存失败");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
