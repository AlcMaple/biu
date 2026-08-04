/**
 * 回归测试：本地歌单同步的「数据不能被清空」这条底线。
 *
 * 背景：线上事故——store rehydrate（异步 IPC 读盘）还没完成，同步就跑了 encodeNow，
 * 拿到空状态，被 diff 解读成「用户删光了全部数据」，把云端和本地一起清空。
 * 这里锁住三件事：等 rehydrate 再 encode、空快照拒绝推送、推送前留本地备份。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Envelope, LiveSnapshot, SyncOp } from "@/service/sync/types";

const store: Record<string, unknown> = {};

vi.mock("@/platform", () => ({
  default: {
    getStore: vi.fn(async (name: string) => store[name]),
    setStore: vi.fn(async (name: string, value: unknown) => {
      store[name] = value;
    }),
  },
  log: { warn: vi.fn(), error: vi.fn() },
}));

const pushOps =
  vi.fn<(store: string, baseVersion: number, ops: SyncOp[], allowFullDelete?: boolean) => Promise<Envelope | null>>();
const pullSnapshot = vi.fn<() => Promise<Envelope | null>>();

vi.mock("@/service/sync/client", () => ({
  getCurrentMid: async () => "12345",
  pullSnapshot: () => pullSnapshot(),
  pushOps: (s: string, b: number, o: SyncOp[], a?: boolean) => pushOps(s, b, o, a),
}));

const { StoreSyncController } = await import("@/service/sync/engine");
const { SYNC_DEBOUNCE_MS, SYNC_MAX_WAIT_MS, SYNC_META_EPOCH } = await import("@/service/sync/config");
const { StoreNameMap } = await import("@shared/store");

const SONG: LiveSnapshot = { "-1:111": { updatedAt: 0, payload: { folderId: -1, item: { rid: 111 } } } };

/** 让本地已经「同步过一次」，基线里有一首歌 */
function seedSyncedMeta() {
  store[StoreNameMap.PlaylistSyncMeta] = {
    "12345": { epoch: SYNC_META_EPOCH, versions: { "fav-items": 3 }, snapshots: { "fav-items": SONG } },
  };
}

function makeController(opts: { waitReady: () => Promise<void>; encodeNow: () => LiveSnapshot }) {
  const applyRemote = vi.fn();
  const controller = new StoreSyncController({ store: "fav-items", applyRemote, ...opts });
  return { applyRemote, controller };
}

/** 触发一次同步并等它跑完（scheduleSync 内部有防抖 + 异步链） */
async function runSync(controller: { scheduleSync: () => void }) {
  controller.scheduleSync();
  await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
  await vi.waitFor(() => expect(true).toBe(true));
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const key of Object.keys(store)) delete store[key];
  pushOps.mockReset();
  pullSnapshot.mockReset();
  // 默认云端与基线同版本（没有别的设备改过），需要模拟"别的设备推过"的用例自行覆盖
  pullSnapshot.mockResolvedValue({ version: 3, updatedAt: 0, data: SONG });
});

describe("同步引擎的数据保护", () => {
  it("rehydrate 未完成时不 encode，等读盘完成后才用真实数据 diff", async () => {
    seedSyncedMeta();
    let hydrated = false;
    let resolveHydration!: () => void;
    const hydration = new Promise<void>(resolve => {
      resolveHydration = () => {
        hydrated = true;
        resolve();
      };
    });
    pushOps.mockResolvedValue({ version: 4, updatedAt: 0, data: SONG });

    const { controller } = makeController({
      waitReady: () => hydration,
      // 读盘没完成时是空的（事故现场），完成后才是真实数据
      encodeNow: () => (hydrated ? SONG : {}),
    });

    controller.scheduleSync();
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(pushOps).not.toHaveBeenCalled(); // 卡在 waitReady 上，一个请求都没发

    resolveHydration();
    await vi.advanceTimersByTimeAsync(0);

    // 本地和基线一致 → 无变更可推，绝不能产生 remove
    const ops = pushOps.mock.calls.flatMap(call => call[2]);
    expect(ops.filter(op => op.type === "remove")).toEqual([]);
  });

  it("本地快照为空而基线非空时，拒绝推送（不把云端删空）", async () => {
    seedSyncedMeta();
    const { applyRemote, controller } = makeController({
      waitReady: async () => undefined, // 假装已就绪，但状态仍是空的（异常重置等意外路径）
      encodeNow: () => ({}),
    });

    await runSync(controller);

    expect(pushOps).not.toHaveBeenCalled();
    expect(applyRemote).not.toHaveBeenCalled(); // 本地也不能被空快照覆盖
  });

  it("正常删除单条时照常推送 remove，闸门不误伤", async () => {
    store[StoreNameMap.PlaylistSyncMeta] = {
      "12345": {
        epoch: SYNC_META_EPOCH,
        versions: { "fav-items": 3 },
        snapshots: {
          "fav-items": { ...SONG, "-1:222": { updatedAt: 0, payload: { folderId: -1, item: { rid: 222 } } } },
        },
      },
    };
    pushOps.mockResolvedValue({ version: 4, updatedAt: 0, data: SONG });

    const { controller } = makeController({
      waitReady: async () => undefined,
      encodeNow: () => SONG, // 两首里删掉一首
    });

    await runSync(controller);

    const ops = pushOps.mock.calls.flatMap(call => call[2]);
    expect(ops).toEqual([{ type: "remove", id: "-1:222", updatedAt: expect.any(Number) }]);
  });

  it("本机没有任何本地变更时，也要把别的设备的改动拉下来", async () => {
    // 真实反馈：Windows 上加的歌，Mac 开着等一天都不下来，重新登录才生效——
    // 因为旧实现只在首次迁移时拉过一次，之后 ops 为空就直接 return，从不再拉。
    seedSyncedMeta();
    const remoteAdded: LiveSnapshot = {
      ...SONG,
      "-1:999": { updatedAt: 0, payload: { folderId: -1, item: { rid: 999 } } },
    };
    pullSnapshot.mockResolvedValue({ version: 7, updatedAt: 0, data: remoteAdded }); // 版本已被另一台设备推进

    const { applyRemote, controller } = makeController({
      waitReady: async () => undefined,
      encodeNow: () => SONG, // 本机一点没改
    });

    await runSync(controller);

    expect(pushOps).not.toHaveBeenCalled(); // 本机无变更，不该推
    expect(applyRemote).toHaveBeenCalledWith(remoteAdded); // 但云端的新增必须落到本地
  });

  it("两边都没动时不写回本地，避免 setState 触发订阅无限空转", async () => {
    seedSyncedMeta();
    const { applyRemote, controller } = makeController({
      waitReady: async () => undefined,
      encodeNow: () => SONG,
    });

    await runSync(controller);

    expect(pushOps).not.toHaveBeenCalled();
    expect(applyRemote).not.toHaveBeenCalled();
  });

  it("推送前把本地现状写进滚动备份", async () => {
    seedSyncedMeta();
    const twoSongs: LiveSnapshot = {
      ...SONG,
      "-1:222": { updatedAt: 0, payload: { folderId: -1, item: { rid: 222 } } },
    };
    pushOps.mockResolvedValue({ version: 4, updatedAt: 0, data: twoSongs });

    const { controller } = makeController({
      waitReady: async () => undefined,
      encodeNow: () => twoSongs,
    });

    await runSync(controller);

    const backups = store[StoreNameMap.PlaylistSyncBackups] as PlaylistSyncBackupsData;
    expect(backups["12345"]["fav-items"][0].snapshot).toEqual(twoSongs);
  });

  it("用户真把唯一歌单删光：本次会话见过数据，照常推送并带上 allowFullDelete", async () => {
    seedSyncedMeta();
    pushOps.mockResolvedValue({ version: 4, updatedAt: 0, data: {} });

    // 第一轮：正常状态，控制器"见过"这个 store 有内容
    let current: LiveSnapshot = SONG;
    const { controller } = makeController({
      waitReady: async () => undefined,
      encodeNow: () => current,
    });
    await runSync(controller);

    // 第二轮：用户删光了
    current = {};
    await runSync(controller);

    const lastCall = pushOps.mock.calls.at(-1)!;
    expect(lastCall[2]).toEqual([{ type: "remove", id: "-1:111", updatedAt: expect.any(Number) }]);
    expect(lastCall[3]).toBe(true); // allowFullDelete：告诉服务端这是用户本人删的，别拦
  });

  it("基线世代号过期（从旧版本升上来）时走只增不删的迁移路径", async () => {
    // 旧版本写的记账没有 epoch 字段，基线不可信：本地缺的条目不能被算成删除推上云
    store[StoreNameMap.PlaylistSyncMeta] = {
      "12345": {
        versions: { "fav-items": 3 },
        snapshots: {
          "fav-items": { ...SONG, "-1:222": { updatedAt: 0, payload: { folderId: -1, item: { rid: 222 } } } },
        },
      },
    };
    pullSnapshot.mockResolvedValue({ version: 3, updatedAt: 0, data: SONG });
    pushOps.mockResolvedValue({ version: 4, updatedAt: 0, data: SONG });

    const { controller } = makeController({
      waitReady: async () => undefined,
      encodeNow: () => SONG, // 本地少了 -1:222（这台设备数据被旧版本 bug 弄丢过）
    });

    await runSync(controller);

    const ops = pushOps.mock.calls.flatMap(call => call[2]);
    expect(ops.filter(op => op.type === "remove")).toEqual([]); // 绝不能删掉另一台设备的数据
  });

  it("连续操作不会把推送饿死：超过最长等待上限就强制推一次", async () => {
    // 真实反馈：快速连收第 4/5/6 首后同步卡住，停手很久才 6 首一起到——
    // 纯防抖每次变更都重置计时器，用户手快时推送被无限往后顺延。
    seedSyncedMeta();
    let songs: LiveSnapshot = SONG;
    pushOps.mockResolvedValue({ version: 4, updatedAt: 0, data: SONG });

    const { controller } = makeController({
      waitReady: async () => undefined,
      encodeNow: () => songs,
    });

    // 每 200ms 收藏一首（快于 400ms 防抖窗口），持续到超过最长等待上限
    for (let i = 0; i < Math.ceil(SYNC_MAX_WAIT_MS / 200) + 1; i++) {
      songs = { ...songs, [`-1:${900 + i}`]: { updatedAt: 0, payload: { folderId: -1, item: { rid: 900 + i } } } };
      controller.scheduleSync();
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.waitFor(() => expect(true).toBe(true));

    // 关键：连续操作期间就已经推过，不是等到停手才一次性全推
    expect(pushOps).toHaveBeenCalled();
  });

  it("syncNow 不走防抖，被通知时立刻同步", async () => {
    seedSyncedMeta();
    pullSnapshot.mockResolvedValue({ version: 9, updatedAt: 0, data: SONG }); // 别的设备推进过版本

    const { applyRemote, controller } = makeController({
      waitReady: async () => undefined,
      encodeNow: () => SONG,
    });

    controller.syncNow();
    await vi.advanceTimersByTimeAsync(0); // 没有前进任何防抖时长
    await vi.waitFor(() => expect(applyRemote).toHaveBeenCalled());
  });
});
