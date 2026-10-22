import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RankingLocalState } from "@shared/play-ranking";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  saved: {} as Partial<RankingLocalState>,
  fail: false,
  legacy: {
    "online:BV1234567890:12": { key: "online:BV1234567890:12", title: "旧记录", totalCount: 3, recentPlays: [] },
  },
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(name, handler) },
}));
vi.mock("electron-log", () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../electron/store", () => ({
  ...Object.fromEntries(
    [
      "appSettingsStore",
      "heartbeatFavSeedsStore",
      "heartbeatServedStore",
      "heartbeatSessionStore",
      "localFavItemsStore",
      "localFavoritesStore",
      "lyricsCacheStore",
      "playlistSyncBackupsStore",
      "playlistSyncMetaStore",
      "shortcutKeyStore",
      "tagsStore",
      "userStore",
    ].map(name => [name, {}]),
  ),
  playCountsStore: {
    get store() {
      return mocks.legacy;
    },
  },
  playRankingSyncStore: {
    get store() {
      return mocks.saved;
    },
    set(value: RankingLocalState) {
      if (mocks.fail) throw new Error("disk failure");
      mocks.saved = structuredClone(value);
    },
  },
}));

import { channel } from "../electron/ipc/channel";
import { registerStoreHandlers } from "../electron/ipc/store";

beforeEach(() => {
  mocks.handlers.clear();
  mocks.saved = {};
  mocks.fail = false;
  registerStoreHandlers();
});
const invoke = (action: unknown) =>
  mocks.handlers.get(channel.store.rankingLocal)!(undefined, action) as Promise<RankingLocalState>;

describe("桌面排行 IPC 的读改写", () => {
  it("并发记录经主进程排队，旧记录保留且只初始化一次", async () => {
    const record = { key: "online:BV1234567890:12", title: "测试歌曲", totalCount: 1, recentPlays: [Date.now()] };
    await Promise.all(Array.from({ length: 20 }, () => invoke({ kind: "record", mid: "42", record })));
    const result = await invoke({ kind: "read" });
    expect(result.accounts["42"].pending.map(event => event.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(result.unassigned).toEqual(mocks.legacy);
    expect(mocks.legacy[record.key].totalCount).toBe(3);
  });

  it("磁盘失败向渲染层报错，下次人工操作仍可执行", async () => {
    mocks.fail = true;
    await expect(invoke({ kind: "read" })).rejects.toThrow("disk failure");
    mocks.fail = false;
    await expect(invoke({ kind: "read" })).resolves.toMatchObject({ schema: 1 });
  });
});
