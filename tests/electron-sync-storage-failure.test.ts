import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreNameMap } from "@shared/store";

const h = vi.hoisted(() => {
  const names = [
    "appSettingsStore",
    "heartbeatFavSeedsStore",
    "heartbeatServedStore",
    "heartbeatSessionStore",
    "localFavItemsStore",
    "localFavoritesStore",
    "lyricsCacheStore",
    "playCountsStore",
    "playRankingSyncStore",
    "playlistSyncBackupsStore",
    "playlistSyncMetaStore",
    "shortcutKeyStore",
    "tagsStore",
    "userStore",
  ];
  return {
    handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
    stores: Object.fromEntries(names.map(name => [name, { store: {}, set: vi.fn(), clear: vi.fn() }])),
  };
});
vi.mock("electron", () => ({
  ipcMain: { handle: (key: string, fn: (...args: unknown[]) => Promise<unknown>) => h.handlers.set(key, fn) },
}));
vi.mock("electron-log", () => ({ default: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("../electron/store", () => h.stores);

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  h.handlers.clear();
  const { registerStoreHandlers } = await import("../electron/ipc/store");
  registerStoreHandlers();
});
afterEach(() => vi.useRealTimers());

const write = (name: StoreName, value: unknown) => h.handlers.get("store:set")!(null, name, value);

describe("Electron同步安全记录", () => {
  it.each([
    [StoreNameMap.PlaylistSyncMeta, "playlistSyncMetaStore"],
    [StoreNameMap.PlaylistSyncBackups, "playlistSyncBackupsStore"],
  ] as const)("%s 保存失败拒绝IPC，不给调用方假成功", async (name, field) => {
    h.stores[field].set.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(write(name, {})).rejects.toThrow("同步安全记录写入失败");
  });

  it("无效安全记录拒绝保存", async () => {
    await expect(write(StoreNameMap.PlaylistSyncMeta, undefined)).rejects.toThrow();
    expect(h.stores.playlistSyncMetaStore.set).not.toHaveBeenCalled();
  });

  it("退避期间新写入取代旧写入时，旧记录拒绝且不覆盖新记录", async () => {
    h.stores.playlistSyncMetaStore.set.mockImplementationOnce(() => {
      throw Object.assign(new Error("locked"), { code: "EBUSY" });
    });
    const old = write(StoreNameMap.PlaylistSyncMeta, { version: 1 });
    const result = old.then(
      () => "resolved",
      () => "rejected",
    );
    await write(StoreNameMap.PlaylistSyncMeta, { version: 2 });
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toBe("rejected");
    expect(h.stores.playlistSyncMetaStore.set.mock.calls).toEqual([[{ version: 1 }], [{ version: 2 }]]);
  });

  it("无并发写入时仍保留本地文件锁重试", async () => {
    h.stores.playlistSyncMetaStore.set.mockImplementationOnce(() => {
      throw Object.assign(new Error("locked"), { code: "EBUSY" });
    });
    const saved = write(StoreNameMap.PlaylistSyncMeta, {});
    await vi.advanceTimersByTimeAsync(200);
    await expect(saved).resolves.toBeUndefined();
    expect(h.stores.playlistSyncMetaStore.set).toHaveBeenCalledTimes(2);
  });
});
