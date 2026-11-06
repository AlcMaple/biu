import { describe, expect, it, vi } from "vitest";

import type { PlaylistPartition } from "@/platform/web-playlist-partition";

import { decodeLegacyPlaylists, planLegacyRecovery } from "@/platform/web-playlist-legacy";
import { mergeLegacyPlaylists } from "@/platform/web-playlist-merge";
import { StoreNameMap } from "@shared/store";

import { legacyPlaylistSample } from "./fixtures/legacy-playlist-sample";

const current = (): PlaylistPartition => ({
  schema: 1,
  likedVersion: 0,
  data: {
    favorites: {
      createdFavorites: [{ id: -1, title: "我喜欢的音乐", isLocal: true }],
      createdOrder: [-1],
      collectedOrder: [],
    },
    items: { folderItems: {}, replaceLogs: {} },
    tags: { tags: [], itemTags: {} },
  },
});
const source = () => decodeLegacyPlaylists(legacyPlaylistSample())!;

describe("非空旧收藏合并，不覆盖当前数据", () => {
  it("同视频不同旧rid合并时仍保留当前裸rid标签", () => {
    const target = current();
    target.data.items.folderItems[-1] = [{ rid: 9, type: 2, bvid: "BV1DEMO00003", title: "当前版本", fav_time: 1 }];
    target.data.tags.tags = [{ id: 99, name: "当前分类", color: "blue" }];
    target.data.tags.itemTags["9"] = [99];
    const result = mergeLegacyPlaylists(target.data, source());
    expect(result.data.tags.itemTags["video:bvid:BV1DEMO00003"]).toEqual([99, 7]);
  });

  it("只有处理记录而没有当前条目的歌单也保留撤销原样", () => {
    const old = source();
    delete old.items.folderItems[-77];
    old.items.replaceLogs[-77] = [
      {
        id: "100001",
        status: "pending",
        original: { rid: 100001, type: 2, title: "旧日志原曲", fav_time: 1 },
        tried: [],
        time: 1,
        mode: "auto",
      },
    ];
    const result = mergeLegacyPlaylists(current().data, old);
    expect(result.data.items.replaceLogs[result.folderIds[-77]][0].original.title).toBe("旧日志原曲");
    expect(result.data.items.folderItems[result.folderIds[-77]]).toEqual([]);
  });
  it("旧音频缺少来源时不猜成本地文件或在线资源", () => {
    const old = source();
    old.items.folderItems[-1].push({ rid: 8, type: 12, title: "未知旧来源", fav_time: 1 });
    expect(() => mergeLegacyPlaylists(current().data, old)).toThrow("来源不明确");
  });
  it("歌单ID碰撞分配新ID并记录映射，保持当前顺序", () => {
    const target = current();
    target.data.favorites.createdFavorites.push({ id: -77, title: "当前歌单", isLocal: true });
    target.data.favorites.createdOrder = [-1, -77];
    target.data.items.folderItems[-77] = [{ rid: 9, type: 2, title: "当前歌", fav_time: 9 }];
    const result = mergeLegacyPlaylists(target.data, source());
    expect(result.folderIds[-77]).not.toBe(-77);
    expect(result.data.items.folderItems[-77][0].title).toBe("当前歌");
    expect(result.data.items.folderItems[result.folderIds[-77]][0].title).toBe("旧版·梦醒时分");
    expect(result.data.favorites.createdOrder).toEqual([-1, -77, result.folderIds[-77]]);
  });
  it("标签ID碰撞重映射，旧关联跟随新ID", () => {
    const target = current();
    target.data.tags.tags = [{ id: 7, name: "当前标签", color: "blue" }];
    const result = mergeLegacyPlaylists(target.data, source());
    expect(result.tagIds[7]).not.toBe(7);
    expect(result.data.tags.tags.map(t => t.name)).toEqual(["当前标签", "旧版标签"]);
    expect(result.data.tags.itemTags["video:bvid:BV1DEMO00003"]).toEqual([result.tagIds[7]]);
  });
  it("同资源去重保留当前歌名时间，标签关联追加且不虚增红心版本", () => {
    const target = current();
    target.likedVersion = 4;
    target.data.items.folderItems[-1] = [
      { rid: "100002", type: 2, bvid: "BV1DEMO00003", title: "当前自定义", fav_time: 999 },
    ];
    target.data.tags.tags = [{ id: 7, name: "当前标签", color: "blue" }];
    target.data.tags.itemTags["video:bvid:BV1DEMO00003"] = [7];
    const result = planLegacyRecovery(target, undefined, legacyPlaylistSample(), "account:900001")!;
    expect(result.partition.data.items.folderItems[-1]).toHaveLength(1);
    expect(result.partition.data.items.folderItems[-1][0].title).toBe("当前自定义");
    expect(result.partition.data.tags.itemTags["video:bvid:BV1DEMO00003"]).toEqual([7, result.receipt.tagIds![7]]);
    expect(result.partition.likedVersion).toBe(4);
  });
  it("裸rid标签规范化，不污染其他文件夹里同数值的音频", () => {
    const sample = legacyPlaylistSample();
    const raw = {
      ...sample,
      [StoreNameMap.Tags]: { tags: sample[StoreNameMap.Tags].tags, itemTags: { "100002": [7] } },
    };
    const target = current();
    target.data.items.folderItems[-88] = [
      { rid: 100002, type: 12, source: "online", title: "同数值音频", fav_time: 1 },
    ];
    const result = mergeLegacyPlaylists(target.data, decodeLegacyPlaylists(raw)!);
    expect(result.data.tags.itemTags["video:bvid:BV1DEMO00003"]).toEqual([7]);
    expect(result.data.tags.itemTags["100002"]).toBeUndefined();
    expect(result.data.tags.itemTags["audio:sid:100002"]).toBeUndefined();
  });
  it("同名歌单不覆盖，完全相同标签定义可复用", () => {
    const target = current();
    target.data.favorites.createdFavorites.push({ id: -77, title: "旧版晚间", isLocal: true });
    target.data.tags.tags = [{ id: 99, name: "旧版标签", color: "#22c55e" }];
    const result = mergeLegacyPlaylists(target.data, source());
    expect(result.data.favorites.createdFavorites.filter(f => f.title === "旧版晚间")).toHaveLength(2);
    expect(result.tagIds[7]).toBe(99);
    expect(result.data.tags.tags).toHaveLength(1);
  });
  it("映射空间不足或标签身份不明时不半途修改双方", () => {
    const target = current();
    target.data.favorites.createdFavorites.push(
      { id: -77, title: "当前", isLocal: true },
      { id: -Number.MAX_SAFE_INTEGER, title: "边界", isLocal: true },
    );
    const before = structuredClone(target);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
    expect(() => mergeLegacyPlaylists(target.data, source())).toThrow("标识空间不足");
    clock.mockRestore();
    expect(target).toEqual(before);
    const bad = source();
    bad.tags.itemTags = { opaque: [7] };
    expect(() => mergeLegacyPlaylists(current().data, bad)).toThrow("缺少资源身份");
  });
});
