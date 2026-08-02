import { describe, expect, it } from "vitest";

import type { FavoriteItem } from "@/store/favorite";
import type { LocalFavItem } from "@/store/local-fav-items";
import type { Tag } from "@/store/tags";

import {
  decodeFavItems,
  decodeFavorites,
  decodeTags,
  diffForMigration,
  diffSnapshots,
  encodeFavItems,
  encodeFavorites,
  encodeTags,
} from "@/service/sync/codec";

const localFolder: FavoriteItem = { id: -1, title: "我喜欢的音乐", isLocal: true, isDefault: true };
const onlineFolder: FavoriteItem = { id: 999, title: "B站收藏夹", isLocal: false };

describe("favorites codec", () => {
  it("only encodes isLocal folders, ignoring B站在线收藏夹", () => {
    const flat = encodeFavorites([localFolder, onlineFolder]);
    expect(Object.keys(flat)).toEqual([String(localFolder.id)]);
  });

  it("round-trips a local folder through encode/decode", () => {
    const flat = encodeFavorites([localFolder]);
    expect(decodeFavorites(flat)).toEqual([localFolder]);
  });
});

describe("fav-items codec", () => {
  const item: LocalFavItem = { rid: "av123", type: 2, title: "song", fav_time: 1000 };

  it("round-trips items grouped by folder", () => {
    const flat = encodeFavItems({ 1: [item] });
    expect(decodeFavItems(flat)).toEqual({ 1: [item] });
  });

  it("uses a composite id so items in different folders never collide", () => {
    const flat = encodeFavItems({ 1: [item], 2: [item] });
    expect(Object.keys(flat).sort()).toEqual(["1:av123", "2:av123"]);
  });
});

describe("tags codec", () => {
  const tag: Tag = { id: 1, name: "喜欢", color: "#fff" };

  it("round-trips tag definitions and item associations", () => {
    const flat = encodeTags([tag], { av123: [1] });
    expect(decodeTags(flat)).toEqual({ tags: [tag], itemTags: { av123: [1] } });
  });

  it("keeps tag ids and rid ids in separate namespaces even if they'd collide numerically", () => {
    const flat = encodeTags([{ id: 1, name: "t", color: "#000" }], { "1": [2] });
    expect(Object.keys(flat).sort()).toEqual(["item:1", "tag:1"]);
  });
});

describe("diffSnapshots (incremental sync)", () => {
  it("upserts new and changed entries, removes vanished ones", () => {
    const baseline = {
      a: { updatedAt: 0, payload: "old-a" },
      b: { updatedAt: 0, payload: "unchanged-b" },
    };
    const local = {
      a: { updatedAt: 0, payload: "new-a" },
      b: { updatedAt: 0, payload: "unchanged-b" },
      c: { updatedAt: 0, payload: "new-c" },
      // "d" was in baseline but not here -> should produce a remove (not exercised, baseline has no d)
    };
    const ops = diffSnapshots(baseline, local, 12345);
    expect(ops).toContainEqual({ type: "upsert", id: "a", payload: "new-a", updatedAt: 12345 });
    expect(ops).toContainEqual({ type: "upsert", id: "c", payload: "new-c", updatedAt: 12345 });
    expect(ops.find(op => op.id === "b")).toBeUndefined();
  });

  it("produces a remove op when an id present in baseline disappears locally", () => {
    const baseline = { gone: { updatedAt: 0, payload: "x" } };
    const ops = diffSnapshots(baseline, {}, 99);
    expect(ops).toEqual([{ type: "remove", id: "gone", updatedAt: 99 }]);
  });
});

describe("diffForMigration（老用户首次迁移，防止数据丢失）", () => {
  it("uploads all local data as upserts when the remote is empty (first-ever sync)", () => {
    const local = {
      a: { updatedAt: 0, payload: "local-a" },
      b: { updatedAt: 0, payload: "local-b" },
    };
    const ops = diffForMigration({}, local, 1);
    expect(ops.sort((x, y) => x.id.localeCompare(y.id))).toEqual([
      { type: "upsert", id: "a", payload: "local-a", updatedAt: 1 },
      { type: "upsert", id: "b", payload: "local-b", updatedAt: 1 },
    ]);
  });

  it("never emits a remove — items missing locally but present remotely must survive untouched", () => {
    // 场景：第二台设备第一次同步，云端已经有另一台设备同步过的数据，
    // 这台设备本地还没有——绝不能因为"本地没有"就把云端数据删掉
    const remote = {
      "already-on-cloud": { updatedAt: 0, payload: "from-other-device" },
    };
    const ops = diffForMigration(remote, {}, 1);
    expect(ops).toEqual([]);
  });

  it("only re-uploads entries that actually differ from the remote baseline", () => {
    const remote = {
      same: { updatedAt: 0, payload: "identical" },
      differs: { updatedAt: 0, payload: "old-value" },
    };
    const local = {
      same: { updatedAt: 0, payload: "identical" },
      differs: { updatedAt: 0, payload: "new-value" },
    };
    const ops = diffForMigration(remote, local, 5);
    expect(ops).toEqual([{ type: "upsert", id: "differs", payload: "new-value", updatedAt: 5 }]);
  });
});
