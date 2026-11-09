import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSyncSafetyGate, type SyncContext, type SyncSafetyView } from "@/service/sync/safety-gate";
import { updateSyncSafetyState, type SyncSafetyAction, type SyncSafetyState } from "@shared/sync-safety";

let saved: SyncSafetyState | undefined;
const live = new Set<string>();
let serial = 0;
function make() {
  let owner: SyncContext | undefined;
  let view: SyncSafetyView = { abandonedIds: [] };
  const storage = vi.fn(async (action: SyncSafetyAction) => {
    saved = updateSyncSafetyState(saved, action);
    return saved;
  });
  const context = async () => {
    if (owner) return owner;
    const id = `owner-${++serial}`;
    live.add(id);
    owner = {
      owner: id,
      liveOwners: async () => new Set(live),
      retire: async () => {
        live.delete(id);
        owner = undefined;
      },
    };
    return owner;
  };
  const gate = createSyncSafetyGate(storage, context, next => {
    view = next;
  });
  return { gate, storage, context, view: () => view };
}
beforeEach(() => {
  saved = undefined;
  live.clear();
  serial = 0;
});

describe("持久化同步请求闸门", () => {
  it("迟到的旧查询不能把已显示的新暂停冲掉", async () => {
    const a = make();
    const ctx = await a.context();
    let release!: (owners: Set<string>) => void;
    const query = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Set<string>>(resolve => {
            release = resolve;
          }),
      )
      .mockImplementation(async () => new Set(live));
    ctx.liveOwners = query;
    const old = a.gate.read();
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    saved = updateSyncSafetyState(saved, { kind: "hold", signal: 503, at: 1 });
    await a.gate.read();
    release(new Set(live));
    await old;
    expect(a.view().state?.hold?.signal).toBe(503);
  });

  it("另一页面明确恢复后，本页再次读取可解除原内存锁定", async () => {
    const a = make();
    await a.gate.begin("request-a");
    a.storage.mockImplementationOnce(async () => {
      throw new Error("quota");
    });
    await expect(a.gate.finish("request-a", 503)).rejects.toThrow();
    const b = make();
    await b.gate.read();
    expect(await b.gate.resume(saved!.revision)).toBe(true);
    await a.gate.read();
    expect(a.view().error).toBeUndefined();
    await expect(a.gate.begin("after-peer-confirmation")).resolves.toBeUndefined();
  });

  it("未确认响应保留意图并撤销存活资格", async () => {
    const a = make();
    await a.gate.begin("uncertain");
    await expect(a.gate.abandon("uncertain")).rejects.toThrow("未确认");
    await a.gate.read();
    expect(a.view().error).toContain("响应未确认");
    expect(saved?.pending?.uncertain).toBeDefined();
    expect(live.has(saved!.pending!.uncertain.owner)).toBe(false);
  });

  it("关闭仍有请求的页面后保守暂停，正常刷新在途也需要明确确认", async () => {
    const a = make();
    await a.gate.begin("watch-a");
    await (await a.context()).retire();
    const b = make();
    await expect(b.gate.begin("after-refresh")).rejects.toThrow("暂停");
    expect(await b.gate.resume(saved!.revision)).toBe(true);
    await expect(b.gate.begin("after-confirmation")).resolves.toBeUndefined();
  });

  it("意图落盘后才允许出站，成功完成才移除对应意图", async () => {
    const a = make();
    await a.gate.begin("request-a");
    expect(saved?.pending?.["request-a"]).toBeDefined();
    await a.gate.finish("request-a");
    expect(saved?.pending).toBeUndefined();
  });
  it("出站意图写盘失败时不获得发送许可", async () => {
    const a = make();
    a.storage.mockImplementation(async action => {
      if (action.kind === "begin") throw new Error("quota");
      return updateSyncSafetyState(saved, action);
    });
    await expect(a.gate.begin("request-a")).rejects.toThrow("暂停");
    expect(saved).toBeUndefined();
  });
  it.each([429, 403, 503, -412])("%i保存后阻断后续请求与重建后的上下文", async signal => {
    const a = make();
    await a.gate.begin("request-a");
    await expect(a.gate.finish("request-a", signal)).rejects.toThrow("暂停");
    await expect(a.gate.begin("request-b")).rejects.toThrow("暂停");
    const b = make();
    await expect(b.gate.begin("request-c")).rejects.toThrow("暂停");
    expect(saved?.hold?.signal).toBe(signal);
  });
  it("首次限制写盘失败仍留意图，并撤销存活锁让另一页面和刷新后都停手", async () => {
    const a = make();
    await a.gate.begin("request-a");
    a.storage.mockImplementationOnce(async () => {
      throw new Error("quota");
    });
    await expect(a.gate.finish("request-a", 429)).rejects.toThrow("暂停");
    expect(live.size).toBe(0);
    expect(saved?.pending?.["request-a"]).toBeDefined();
    const b = make();
    await expect(b.gate.begin("request-b")).rejects.toThrow("暂停");
    expect(b.view().abandonedIds).toEqual(["request-a"]);
    expect(saved?.pending?.["request-b"]).toBeUndefined();
  });
  it("存活页面的长请求不阻塞另一页面的正常请求", async () => {
    const a = make();
    const b = make();
    await a.gate.begin("watch-a");
    await b.gate.begin("push-b");
    expect(Object.keys(saved?.pending ?? {})).toEqual(["watch-a", "push-b"]);
    await b.gate.finish("push-b");
    expect(saved?.pending?.["watch-a"]).toBeDefined();
  });
  it("旧确认不抹掉新限制，恢复只清理遗留请求不清理仍存活请求", async () => {
    const a = make();
    const b = make();
    await a.gate.begin("watch-a");
    const owner = await b.context();
    await b.gate.begin("request-b");
    await owner.retire();
    const before = await a.gate.read();
    saved = updateSyncSafetyState(saved, { kind: "hold", signal: 429, at: 1 });
    expect(await a.gate.resume(before.state!.revision)).toBe(false);
    expect(await a.gate.resume(saved.revision)).toBe(true);
    expect(saved?.pending?.["watch-a"]).toBeDefined();
    expect(saved?.pending?.["request-b"]).toBeUndefined();
  });
  it("恢复写盘失败保留暂停；人工再次确认后才重新允许请求", async () => {
    const a = make();
    await a.gate.begin("request-a");
    await expect(a.gate.finish("request-a", 503)).rejects.toThrow();
    const rev = saved!.revision;
    a.storage.mockImplementation(async action => {
      if (action.kind === "resume") throw new Error("disk");
      return (saved = updateSyncSafetyState(saved, action));
    });
    await expect(a.gate.resume(rev)).rejects.toThrow();
    expect(saved?.hold?.signal).toBe(503);
    a.storage.mockImplementation(async action => (saved = updateSyncSafetyState(saved, action)));
    expect(await a.gate.resume(saved!.revision)).toBe(true);
    await expect(a.gate.begin("request-new")).resolves.toBeUndefined();
  });
  it("已发出请求的正常完成不清掉另一请求的新限制", async () => {
    const a = make();
    await a.gate.begin("request-a");
    await a.gate.begin("request-b");
    await expect(a.gate.finish("request-a", 429)).rejects.toThrow();
    await expect(a.gate.finish("request-b")).rejects.toThrow();
    expect(saved?.hold?.signal).toBe(429);
  });
});
