import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreNameMap } from "@shared/store";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal("indexedDB", undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("Web同步安全记录", () => {
  it.each([StoreNameMap.PlaylistSyncMeta, StoreNameMap.PlaylistSyncBackups] as const)(
    "%s 的IndexedDB不可用时拒绝读写，不把回退存储空值当基线",
    async name => {
      const { default: platform } = await import("@/platform/web");
      await expect(platform.getStore(name)).rejects.toThrow();
      await expect(platform.setStore(name, {})).rejects.toThrow();
      expect(localStorage.getItem(`biu:${name}`)).toBeNull();
    },
  );

  it("普通偏好仍保留原localStorage兼容路径", async () => {
    const { default: platform } = await import("@/platform/web");
    await platform.setStore(StoreNameMap.HeartbeatServed, { bvids: [], keys: [] });
    await expect(platform.getStore(StoreNameMap.HeartbeatServed)).resolves.toEqual({ bvids: [], keys: [] });
  });

  it("写事务取消时拒绝，不承认备份已保存", async () => {
    const transaction = {
      error: new Error("quota"),
      onabort: null as (() => void) | null,
      objectStore: () => ({ put: vi.fn() }),
    };
    const open = { result: { transaction: () => transaction }, onsuccess: null as (() => void) | null };
    vi.stubGlobal("indexedDB", { open: () => open });
    const { default: platform } = await import("@/platform/web");
    const saved = platform.setStore(StoreNameMap.PlaylistSyncBackups, {});
    const result = saved.then(
      () => "resolved",
      () => "rejected",
    );
    open.onsuccess?.();
    await Promise.resolve();
    transaction.onabort?.();
    expect(await result).toBe("rejected");
  });

  it("已确认不存在的记录仍返回undefined，不误报存储错误", async () => {
    const request = { result: undefined, onsuccess: null as (() => void) | null };
    const transaction = {
      oncomplete: null as (() => void) | null,
      objectStore: () => ({ get: () => request }),
    };
    const open = { result: { transaction: () => transaction }, onsuccess: null as (() => void) | null };
    vi.stubGlobal("indexedDB", { open: () => open });
    const { default: platform } = await import("@/platform/web");
    const read = platform.getStore(StoreNameMap.PlaylistSyncMeta);
    open.onsuccess?.();
    await Promise.resolve();
    request.onsuccess?.();
    transaction.oncomplete?.();
    await expect(read).resolves.toBeUndefined();
  });

  it("读请求成功后事务取消仍拒绝，不提前承认数据就绪", async () => {
    const request = { result: {}, onsuccess: null as (() => void) | null };
    const transaction = {
      error: new Error("aborted"),
      onabort: null as (() => void) | null,
      oncomplete: null as (() => void) | null,
      objectStore: () => ({ get: () => request }),
    };
    const open = { result: { transaction: () => transaction }, onsuccess: null as (() => void) | null };
    vi.stubGlobal("indexedDB", { open: () => open });
    const { default: platform } = await import("@/platform/web");
    const read = platform.getStore(StoreNameMap.PlaylistSyncMeta);
    const result = read.then(
      () => "resolved",
      () => "rejected",
    );
    open.onsuccess?.();
    await Promise.resolve();
    request.onsuccess?.();
    transaction.onabort?.();
    expect(await result).toBe("rejected");
  });

  it("事务提交后才返回基线", async () => {
    const saved = { "12345": { versions: {}, snapshots: {} } };
    const request = { result: saved, onsuccess: null as (() => void) | null };
    const transaction = {
      oncomplete: null as (() => void) | null,
      objectStore: () => ({ get: () => request }),
    };
    const open = { result: { transaction: () => transaction }, onsuccess: null as (() => void) | null };
    vi.stubGlobal("indexedDB", { open: () => open });
    const { default: platform } = await import("@/platform/web");
    const read = platform.getStore(StoreNameMap.PlaylistSyncMeta);
    const resolved = vi.fn();
    void read.then(resolved);
    open.onsuccess?.();
    await Promise.resolve();
    request.onsuccess?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    transaction.oncomplete?.();
    await expect(read).resolves.toEqual(saved);
  });
});
