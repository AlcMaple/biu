import { describe, expect, it, vi } from "vitest";

import { notifyChange, pendingWaiters, waitForChange } from "../events.js";

describe("版本变更总线", () => {
  it("有写入时立刻唤醒等待中的请求", async () => {
    const waiting = waitForChange("12345", 5000);
    notifyChange("12345");
    await expect(waiting).resolves.toBe(true);
  });

  it("超时返回 false，让客户端发起下一轮长轮询", async () => {
    vi.useFakeTimers();
    const waiting = waitForChange("12345", 25_000);
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(waiting).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("只唤醒同一 mid 的等待者，不串号", async () => {
    const mine = waitForChange("12345", 5000);
    const others = waitForChange("99999", 5000);
    let othersSettled = false;
    void others.then(() => {
      othersSettled = true;
    });

    notifyChange("12345");

    await expect(mine).resolves.toBe(true);
    expect(othersSettled).toBe(false);
  });

  it("唤醒和超时两条路径都会摘掉监听器，长期运行不泄漏", async () => {
    expect(pendingWaiters("55555")).toBe(0);

    // 唤醒路径
    for (let i = 0; i < 50; i++) {
      const waiting = waitForChange("55555", 5000);
      notifyChange("55555");
      await waiting;
    }
    expect(pendingWaiters("55555")).toBe(0);

    // 超时路径
    vi.useFakeTimers();
    const waiting = waitForChange("55555", 25_000);
    expect(pendingWaiters("55555")).toBe(1);
    await vi.advanceTimersByTimeAsync(25_000);
    await waiting;
    vi.useRealTimers();

    expect(pendingWaiters("55555")).toBe(0);
  });
});
