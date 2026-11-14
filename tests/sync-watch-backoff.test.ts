import { describe, expect, it } from "vitest";

import { watchRetryDelay } from "@/service/sync/watch-backoff";

const mid = () => 0.5;

describe("通知通道重连间隔", () => {
  it("前几次断线很快重连，连续失败后拉长到 5 分钟封顶，不再固定每 30 秒一次", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map(n => watchRetryDelay(n, undefined, 0, mid))).toEqual([
      2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 300_000,
    ]);
  });

  it("带随机抖动，避免所有客户端同一秒涌回来", () => {
    expect(watchRetryDelay(6, undefined, 0, () => 0)).toBe(240_000);
    expect(watchRetryDelay(6, undefined, 0, () => 1)).toBe(360_000);
  });

  it("服务器给了 Retry-After 或换凭证在冷却期时，按更长的那个等", () => {
    expect(watchRetryDelay(0, 240_000, 0, mid)).toBe(240_000);
    expect(watchRetryDelay(0, undefined, 180_000, mid)).toBe(180_000);
  });
});
