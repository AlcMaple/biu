import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaylistPartition, PlaylistPartitionStore } from "@/platform/web-playlist-partition";

const item = { rid: 1, type: 2, title: "合成歌曲", fav_time: 100 };

function storage() {
  const records = new Map<string, PlaylistPartition>();
  let release: Promise<void> | undefined;
  let failure: Error | undefined;
  const store: PlaylistPartitionStore = {
    read: async scope => structuredClone(records.get(scope)),
    update: async (scope, transform) => {
      await release;
      if (failure) throw failure;
      const next = transform(structuredClone(records.get(scope)));
      records.set(scope, structuredClone(next.partition));
      return next.result;
    },
  };
  return {
    store,
    records,
    hold: (value: Promise<void>) => (release = value),
    fail: () => (failure = new Error("模拟写盘失败")),
  };
}

describe("Web 分区页面启动与写盘边界", () => {
  it("换身份丢弃旧私有歌单路由，但不重置公共搜索路径或数据", async () => {
    const runtime = await import("@/platform/web-playlist-runtime");
    const old = window.location.hash;
    try {
      window.location.hash = "#/local-collection/-77";
      runtime.resetWebPlaylistPrivateRoute();
      expect(window.location.hash).toBe("#/");
      window.location.hash = "#/search";
      runtime.resetWebPlaylistPrivateRoute();
      expect(window.location.hash).toBe("#/search");
    } finally {
      window.location.hash = old;
    }
  });
  beforeEach(() => vi.resetModules());

  it("同步只认可已启动的匹配账号，关闭后立即失效", async () => {
    const runtime = await import("@/platform/web-playlist-runtime");
    expect(runtime.isWebPlaylistSessionCurrent("900001")).toBe(false);
    runtime.startWebPlaylistSession(storage().store, 900001);
    expect(runtime.isWebPlaylistSessionCurrent("900001")).toBe(true);
    expect(runtime.isWebPlaylistSessionCurrent("900002")).toBe(false);
    runtime.closeWebPlaylistSession();
    expect(runtime.isWebPlaylistSessionCurrent("900001")).toBe(false);
  });

  it("访客分区不作为登录账号同步会话", async () => {
    const runtime = await import("@/platform/web-playlist-runtime");
    runtime.startWebPlaylistSession(storage().store, null);
    expect(runtime.isWebPlaylistSessionCurrent("900001")).toBe(false);
    expect(runtime.isWebPlaylistSessionCurrent("")).toBe(false);
  });

  it("启动身份明确前不向页面返回默认空收藏", async () => {
    const runtime = await import("@/platform/web-playlist-runtime");
    const memory = storage();
    let settled = false;
    const read = runtime.readWebPlaylistPartition("items").then(value => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    runtime.startWebPlaylistSession(memory.store, 900001);
    expect(await read).toEqual({ folderItems: {}, replaceLogs: {} });
  });

  it("捕获写入输入，身份已确定后只写该账号", async () => {
    const runtime = await import("@/platform/web-playlist-runtime");
    const memory = storage();
    const input = { folderItems: { [-1]: [structuredClone(item)] }, replaceLogs: {} };
    const pending = runtime.writeWebPlaylistPartition("items", input);
    input.folderItems[-1][0].title = "调用后修改";
    runtime.startWebPlaylistSession(memory.store, 900001);
    await pending;
    expect((await runtime.readWebPlaylistPartition("items")).folderItems[-1][0].title).toBe("合成歌曲");
    expect([...memory.records.keys()]).toEqual(["account:900001"]);
  });

  it("同身份启动可复用，身份改变必须过完整重载边界", async () => {
    const runtime = await import("@/platform/web-playlist-runtime");
    const memory = storage();
    const first = runtime.startWebPlaylistSession(memory.store, 900001);
    expect(runtime.startWebPlaylistSession(memory.store, 900001)).toBe(first);
    expect(() => runtime.startWebPlaylistSession(memory.store, 900002)).toThrow("身份已变化");
  });

  it("切换前flush等待已开始的写盘", async () => {
    const runtime = await import("@/platform/web-playlist-runtime");
    const memory = storage();
    let release!: () => void;
    memory.hold(new Promise<void>(resolve => (release = resolve)));
    runtime.startWebPlaylistSession(memory.store, 900001);
    void runtime.writeWebPlaylistPartition("items", { folderItems: { [-1]: [item] }, replaceLogs: {} });
    let flushed = false;
    const flush = runtime.flushWebPlaylistWrites().then(() => (flushed = true));
    await Promise.resolve();
    expect(flushed).toBe(false);
    release();
    await flush;
    expect(memory.records.get("account:900001")!.data.items.folderItems[-1]).toHaveLength(1);
  });

  it("写盘失败可见且阻断切换，不伪装flush成功", async () => {
    const runtime = await import("@/platform/web-playlist-runtime");
    const memory = storage();
    memory.fail();
    const listener = vi.fn();
    const unsubscribe = runtime.onWebPlaylistWriteError(listener);
    runtime.startWebPlaylistSession(memory.store, null);
    await runtime.writeWebPlaylistPartition("items", { folderItems: { [-1]: [item] }, replaceLogs: {} });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ message: "模拟写盘失败" }));
    await expect(runtime.flushWebPlaylistWrites()).rejects.toThrow("模拟写盘失败");
    expect(memory.records.size).toBe(0);
    unsubscribe();
  });

  it("旧会话关闭后迟到写盘不会落到新账号", async () => {
    const runtime = await import("@/platform/web-playlist-runtime");
    const memory = storage();
    let release!: () => void;
    memory.hold(new Promise<void>(resolve => (release = resolve)));
    runtime.startWebPlaylistSession(memory.store, 900001);
    const write = runtime.writeWebPlaylistPartition("items", { folderItems: { [-1]: [item] }, replaceLogs: {} });
    runtime.closeWebPlaylistSession();
    release();
    await write;
    await expect(runtime.flushWebPlaylistWrites()).rejects.toThrow("会话已切换");
    expect(memory.records.size).toBe(0);
    await expect(runtime.readWebPlaylistPartition("items")).rejects.toThrow("会话已切换");
  });

  it("启动失败向等待者报错，不把未知/旧数据当空歌单", async () => {
    const runtime = await import("@/platform/web-playlist-runtime");
    const pending = runtime.readWebPlaylistPartition("favorites");
    runtime.failWebPlaylistStartup(new Error("旧版收藏原件已保留"));
    await expect(pending).rejects.toThrow("旧版收藏原件已保留");
  });
});
