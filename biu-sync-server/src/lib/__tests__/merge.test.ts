import { describe, expect, it } from "vitest";

import { applyOps, pruneTombstones, type StoreData, type SyncOp } from "../merge.js";

describe("applyOps", () => {
  it("upserts a new item into empty data", () => {
    const ops: SyncOp[] = [{ type: "upsert", id: "a", payload: { name: "song-a" }, updatedAt: 100 }];
    const result = applyOps({}, ops);
    expect(result.a).toEqual({ updatedAt: 100, payload: { name: "song-a" } });
  });

  it("merges non-overlapping ops from two devices without conflict", () => {
    const current: StoreData = { a: { updatedAt: 1, payload: "from-mac" } };
    const opsFromWindows: SyncOp[] = [{ type: "upsert", id: "b", payload: "from-win", updatedAt: 2 }];
    const result = applyOps(current, opsFromWindows);
    expect(result.a).toEqual({ updatedAt: 1, payload: "from-mac" });
    expect(result.b).toEqual({ updatedAt: 2, payload: "from-win" });
  });

  it("last-write-wins when the same id is edited on both devices", () => {
    const current: StoreData = { a: { updatedAt: 100, payload: "newer" } };
    const staleOp: SyncOp[] = [{ type: "upsert", id: "a", payload: "older", updatedAt: 50 }];
    const result = applyOps(current, staleOp);
    // 迟到的旧数据不应覆盖已经更新的记录
    expect(result.a).toEqual({ updatedAt: 100, payload: "newer" });
  });

  it("a later upsert overrides an earlier remove", () => {
    const current: StoreData = { a: { __deleted: true, updatedAt: 10 } };
    const laterUpsert: SyncOp[] = [{ type: "upsert", id: "a", payload: "revived", updatedAt: 20 }];
    const result = applyOps(current, laterUpsert);
    expect(result.a).toEqual({ updatedAt: 20, payload: "revived" });
  });

  it("an earlier upsert loses to an existing later tombstone (delete wins the race)", () => {
    const current: StoreData = { a: { __deleted: true, updatedAt: 20 } };
    const earlierUpsert: SyncOp[] = [{ type: "upsert", id: "a", payload: "stale-add", updatedAt: 10 }];
    const result = applyOps(current, earlierUpsert);
    expect(result.a).toEqual({ __deleted: true, updatedAt: 20 });
  });

  it("remove creates a tombstone instead of physically deleting the key", () => {
    const current: StoreData = { a: { updatedAt: 1, payload: "x" } };
    const ops: SyncOp[] = [{ type: "remove", id: "a", updatedAt: 2 }];
    const result = applyOps(current, ops);
    expect(result.a).toEqual({ __deleted: true, updatedAt: 2 });
  });
});

describe("pruneTombstones", () => {
  it("removes tombstones older than the retention window", () => {
    const now = 1_000_000;
    const retentionMs = 1000;
    const data: StoreData = {
      old: { __deleted: true, updatedAt: now - retentionMs - 1 },
      recent: { __deleted: true, updatedAt: now - 10 },
      live: { updatedAt: now - 10, payload: "still here" },
    };
    const result = pruneTombstones(data, retentionMs, now);
    expect(result.old).toBeUndefined();
    expect(result.recent).toBeDefined();
    expect(result.live).toBeDefined();
  });
});
