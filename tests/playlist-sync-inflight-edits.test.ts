import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Envelope, FlatSnapshot, LiveSnapshot, SyncOp } from "@/service/sync/types";

const store: Record<string, unknown> = {};

vi.mock("@/platform", () => ({
  default: {
    getStore: vi.fn(async (name: string) => store[name]),
    setStore: vi.fn(async (name: string, value: unknown) => {
      // 真实写盘要经过 IndexedDB / IPC，不是瞬间完成
      await new Promise(resolve => setTimeout(resolve, 5));
      store[name] = value;
    }),
  },
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const pushOps = vi.fn<(s: string, b: number, o: SyncOp[], a?: boolean, mid?: string) => Promise<Envelope | null>>();
const pullSnapshot = vi.fn<(s?: string, mid?: string) => Promise<Envelope | null>>();

vi.mock("@/service/sync/client", () => ({
  getCurrentMid: async () => "12345",
  pullSnapshot: (s?: string, mid?: string) => pullSnapshot(s, mid),
  pushOps: (s: string, b: number, o: SyncOp[], a?: boolean, mid?: string) => pushOps(s, b, o, a, mid),
}));

const { StoreSyncController } = await import("@/service/sync/engine");
const { SYNC_DEBOUNCE_MS, SYNC_META_EPOCH } = await import("@/service/sync/config");
const { StoreNameMap } = await import("@shared/store");

const entry = (rid: number) => ({ updatedAt: 0, payload: { rid } });
const A: LiveSnapshot = { "1:1": entry(1) };

let local: LiveSnapshot;
let applied: FlatSnapshot | undefined;

function controller() {
  return new StoreSyncController({
    store: "fav-items",
    waitReady: async () => {},
    encodeNow: () => local,
    applyRemote: flat => {
      applied = flat;
      local = Object.fromEntries(Object.entries(flat).filter(([, e]) => !e.__deleted)) as LiveSnapshot;
    },
  });
}

async function settle() {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS * 10);
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const key of Object.keys(store)) delete store[key];
  pushOps.mockReset();
  pullSnapshot.mockReset();
  applied = undefined;
  local = { ...A };
  store[StoreNameMap.PlaylistSyncMeta] = {
    "12345": { epoch: SYNC_META_EPOCH, versions: { "fav-items": 1 }, snapshots: { "fav-items": A } },
  };
});

describe("同步请求在路上时的本机改动", () => {
  it("推送途中新收藏的歌不会被推送结果盖掉，之后会补传", async () => {
    let version = 1;
    const server: FlatSnapshot = { ...A };
    pushOps.mockImplementation(async (_s, _b, ops) => {
      if (version === 1) local = { ...local, "1:3": entry(3) };
      for (const op of ops)
        server[op.id] =
          op.type === "upsert"
            ? { updatedAt: op.updatedAt, payload: op.payload }
            : { __deleted: true, updatedAt: op.updatedAt };
      version += 1;
      return { version, updatedAt: 0, data: { ...server } };
    });
    const c = controller();
    local = { ...local, "1:2": entry(2) };
    c.scheduleSync();
    await settle();
    expect(Object.keys(local).sort()).toEqual(["1:1", "1:2", "1:3"]);
    expect(Object.keys(server).sort()).toEqual(["1:1", "1:2", "1:3"]);
  });

  it("拉取途中做的改动不会被拉取结果盖掉", async () => {
    pullSnapshot.mockImplementation(async () => {
      local = { ...local, "1:9": entry(9) };
      return { version: 2, updatedAt: 0, data: { ...A, "1:5": entry(5) } };
    });
    pushOps.mockImplementation(async (_s, b, ops) => ({
      version: b + 1,
      updatedAt: 0,
      data: Object.fromEntries([
        ...Object.entries({ ...A, "1:5": entry(5) }),
        ...ops.map(op => [op.id, { updatedAt: 0, payload: (op as { payload: unknown }).payload }]),
      ]),
    }));
    const c = controller();
    c.syncNow();
    await settle();
    expect(Object.keys(applied ?? {}).sort()).toContain("1:9");
    expect(Object.keys(local).sort()).toEqual(["1:1", "1:5", "1:9"]);
    expect(pushOps.mock.calls.flatMap(call => call[2]).map(op => op.id)).toContain("1:9");
  });
});

describe("三个 store 共用同步记录", () => {
  it("同时完成首次同步时，各自的同步进度都记得住", async () => {
    store[StoreNameMap.PlaylistSyncMeta] = {};
    pullSnapshot.mockImplementation(async s => ({ version: s === "tags" ? 5 : 9, updatedAt: 0, data: {} }));
    const make = (name: "tags" | "fav-items") =>
      new StoreSyncController({ store: name, waitReady: async () => {}, encodeNow: () => ({}), applyRemote: () => {} });
    const a = make("tags");
    const b = make("fav-items");
    a.syncNow();
    b.syncNow();
    await settle();
    const meta = store[StoreNameMap.PlaylistSyncMeta] as PlaylistSyncMetaData;
    expect(meta["12345"].versions).toEqual({ tags: 5, "fav-items": 9 });
  });
});
