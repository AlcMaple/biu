import { describe, expect, it } from "vitest";

import type { PlaylistPartition } from "@/platform/web-playlist-partition";

import { decodeLegacyPlaylists, planLegacyRecovery } from "@/platform/web-playlist-legacy";
import { StoreNameMap } from "@shared/store";

import { legacyPlaylistSample } from "./fixtures/legacy-playlist-sample";

const blank = (): PlaylistPartition => ({
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

describe("旧版收藏明确恢复到空身份", () => {
  it("解析已知旧协议，保留歌曲身份、自定义字段、标签和排序，缺省日志兼容", () => {
    const raw = legacyPlaylistSample();
    const before = structuredClone(raw);
    const data = decodeLegacyPlaylists(raw)!;
    expect(data.favorites.createdOrder).toEqual([-77, -1]);
    expect(data.items.folderItems[-77][0].customArtist).toBe("旧版自定歌手");
    expect(data.tags.itemTags["video:bvid:BV1DEMO00003"]).toEqual([7]);
    expect(data.items.replaceLogs).toEqual({});
    expect(raw).toEqual(before);
  });

  it("无原件和清除墓碑不恢复出空替身", () => {
    expect(
      decodeLegacyPlaylists({
        [StoreNameMap.LocalFavorites]: undefined,
        [StoreNameMap.LocalFavItems]: null,
        [StoreNameMap.Tags]: undefined,
      }),
    ).toBeNull();
  });

  it("不明旧格式、缺歌单归属或损坏标签不被静默丢弃", () => {
    const raw = legacyPlaylistSample();
    expect(() => decodeLegacyPlaylists({ ...raw, [StoreNameMap.LocalFavItems]: { unknownOldVersion: true } })).toThrow(
      "未识别",
    );
    expect(() => decodeLegacyPlaylists({ ...raw, [StoreNameMap.LocalFavorites]: { createdFavorites: [] } })).toThrow(
      "缺少歌单归属",
    );
    expect(() =>
      decodeLegacyPlaylists({ ...raw, [StoreNameMap.Tags]: { tags: [], itemTags: { resource: "损坏" } } }),
    ).toThrow("标签归属异常");
  });

  it("仅明确计划才复制全部三个store，原件快照与目标无可变引用共享", () => {
    const raw = legacyPlaylistSample();
    const target = blank();
    target.guestDecision = { version: 4, choice: "keep" };
    const result = planLegacyRecovery(target, undefined, raw, "account:900001")!;
    expect(result.receipt.owner).toBe("account:900001");
    expect(result.partition.guestDecision).toEqual(target.guestDecision);
    expect(result.partition.data.items.folderItems[-1][0].title).toBe("旧版·Apologize");
    result.partition.data.items.folderItems[-1][0].title = "新目标修改";
    expect(raw[StoreNameMap.LocalFavItems].folderItems[-1][0].title).toBe("旧版·Apologize");
    expect(result.receipt.raw).toEqual(raw);
  });

  it("已有歌曲、标签或自建歌单的目标都不被覆盖", () => {
    const raw = legacyPlaylistSample();
    for (const kind of ["song", "tag", "folder"]) {
      const target = blank();
      if (kind === "song")
        target.data.items.folderItems[-1] = [{ rid: 9, type: 2, title: "账号自己的歌", fav_time: 1 }];
      if (kind === "tag") target.data.tags.tags.push({ id: 1, name: "自己的标签", color: "red" });
      if (kind === "folder")
        target.data.favorites.createdFavorites.push({ id: -8, title: "自己的歌单", isLocal: true });
      const before = structuredClone(target);
      const merged = planLegacyRecovery(target, undefined, raw, "account:900001")!;
      if (kind === "song") expect(merged.partition.data.items.folderItems[-1][0].title).toBe("账号自己的歌");
      if (kind === "tag") expect(merged.partition.data.tags.tags[0].name).toBe("自己的标签");
      if (kind === "folder") expect(merged.partition.data.favorites.createdFavorites.some(f => f.id === -8)).toBe(true);
      expect(target).toEqual(before);
    }
  });

  it("同账号重复恢复幂等，另一账号不再次取得已归属原件", () => {
    const raw = legacyPlaylistSample();
    const first = planLegacyRecovery(undefined, undefined, raw, "account:900001")!;
    expect(planLegacyRecovery(first.partition, first.receipt, raw, "account:900001")).toBeNull();
    expect(() => planLegacyRecovery(undefined, first.receipt, raw, "account:900002")).toThrow("另一身份");
  });
});
