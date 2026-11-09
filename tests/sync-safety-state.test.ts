import { describe, expect, it } from "vitest";

import { readSyncSafetyState, syncHoldReason, updateSyncSafetyState } from "@shared/sync-safety";

describe("同步暂停记录协议", () => {
  it.each([429, 403, 412, 418, -412, -509, -352, 500, 503, 599])("将信号 %i 保存为有版本的暂停", signal => {
    const next = updateSyncSafetyState(undefined, { kind: "hold", signal, at: 100 });
    expect(next).toEqual({ schema: 1, revision: 1, hold: { reason: syncHoldReason(signal), signal, at: 100 } });
  });

  it.each([0, 401, 404, 409, 600, 500.5])("不将信号 %i 错归到人工停手", signal => {
    expect(syncHoldReason(signal)).toBeUndefined();
    expect(() => updateSyncSafetyState(undefined, { kind: "hold", signal, at: 100 })).toThrow();
  });

  it("读取与重启不根据经过时间自动解除暂停", () => {
    const saved = updateSyncSafetyState(undefined, { kind: "hold", signal: 503, at: 1 });
    expect(updateSyncSafetyState(JSON.parse(JSON.stringify(saved)), { kind: "read" })).toEqual(saved);
  });

  it("重复收到同类错误仍递增版本，旧确认不解除新暂停", () => {
    const first = updateSyncSafetyState(undefined, { kind: "hold", signal: 429, at: 10 });
    const later = updateSyncSafetyState(first, { kind: "hold", signal: 429, at: 10 });
    expect(updateSyncSafetyState(later, { kind: "resume", expectedRevision: first.revision })).toEqual(later);
    expect(updateSyncSafetyState(later, { kind: "resume", expectedRevision: later.revision })).toEqual({
      schema: 1,
      revision: 3,
      hold: null,
    });
  });

  it("确认恢复后迟到的新错误再次暂停", () => {
    const held = updateSyncSafetyState(undefined, { kind: "hold", signal: 503, at: 10 });
    const resumed = updateSyncSafetyState(held, { kind: "resume", expectedRevision: 1 });
    expect(updateSyncSafetyState(resumed, { kind: "hold", signal: 503, at: 11 })).toMatchObject({
      revision: 3,
      hold: { signal: 503 },
    });
  });

  it.each([null, {}, [], { schema: 2, revision: 1, hold: null }, { schema: 1, revision: 1, hold: {} }])(
    "损坏记录不当空记录重置：%j",
    saved => expect(() => readSyncSafetyState(saved)).toThrow(),
  );

  it("未知IPC操作、非法时间与版本上限均拒绝且原记录不变", () => {
    const held = updateSyncSafetyState(undefined, { kind: "hold", signal: 503, at: 10 });
    for (const action of [
      { kind: "clear" },
      { kind: "resume", expectedRevision: -1 },
      { kind: "hold", signal: 429, at: NaN },
    ]) {
      expect(() => updateSyncSafetyState(held, action)).toThrow();
    }
    expect(() =>
      updateSyncSafetyState({ ...held, revision: Number.MAX_SAFE_INTEGER }, { kind: "hold", signal: 503, at: 11 }),
    ).toThrow();
    expect(held.revision).toBe(1);
  });
});
