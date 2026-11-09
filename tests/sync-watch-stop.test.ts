import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ watch: vi.fn(), resume: undefined as (() => void) | undefined }));
vi.mock("@/common/offline-demo", () => ({ isOfflineDemo: false }));
vi.mock("@/platform", () => ({ log: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/platform/web-playlist-runtime", () => ({ isWebPlaylistSessionCurrent: () => true }));
vi.mock("@/store/user", () => ({
  useUser: { getState: () => ({ user: { mid: 42, isLogin: true } }), subscribe: vi.fn() },
}));
vi.mock("@/store/favorite", () => ({ useFavoritesStore: { subscribe: vi.fn() } }));
vi.mock("@/store/local-fav-items", () => ({ useLocalFavItemsStore: { subscribe: vi.fn() } }));
vi.mock("@/store/tags", () => ({ useTagStore: { subscribe: vi.fn() } }));
vi.mock("@/store/play-ranking", () => ({ resetPlayRankingSession: vi.fn(), syncPlayRanking: vi.fn(async () => {}) }));
vi.mock("@/service/sync/safety", () => ({
  onSyncSafetyResumed: (fn: () => void) => {
    h.resume = fn;
  },
}));
vi.mock("@/service/sync/engine", () => ({
  StoreSyncController: class {
    syncNow() {}
    resetSession() {}
    resumeAfterPause() {}
    scheduleSync() {}
    hasSynced() {
      return false;
    }
  },
}));
vi.mock("@/service/sync/client", () => ({
  getKnownSyncMid: () => "42",
  invalidateSyncToken: vi.fn(),
  watchVersions: (...args: unknown[]) => h.watch(...args),
}));
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  h.watch.mockReset();
  h.resume = undefined;
});
afterEach(() => vi.useRealTimers());
it("暂停错误终止通知退避，显式恢复才重启", async () => {
  h.watch.mockRejectedValueOnce({ code: "BIU_SYNC_PAUSED" }).mockImplementation(() => new Promise(() => {}));
  const { initLocalPlaylistSync } = await import("@/service/sync");
  initLocalPlaylistSync();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.watch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.watch).toHaveBeenCalledTimes(1);
  h.resume?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.watch).toHaveBeenCalledTimes(2);
});
it("普通断网仍沿原通知退避，不伪装成持久化暂停", async () => {
  h.watch.mockRejectedValueOnce(new Error("offline")).mockImplementation(() => new Promise(() => {}));
  const { initLocalPlaylistSync } = await import("@/service/sync");
  initLocalPlaylistSync();
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.watch).toHaveBeenCalledTimes(2);
});
