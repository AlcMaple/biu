import { describe, expect, test } from "vitest";

import type { LocalFavItem } from "@/store/local-fav-items";

import { resolveLocalFavoriteSelection, toLocalFavoriteModalData } from "@/common/utils/fav";

const makeItem = (partial: Partial<LocalFavItem>): LocalFavItem => ({
  rid: 1,
  type: 2,
  title: "t",
  fav_time: 0,
  source: "online",
  ...partial,
});

describe("本地歌单二次收藏", () => {
  test("分P条目用 cid 作为身份并保留用户自定义标题/分集信息", () => {
    const item = makeItem({
      rid: "987654",
      type: 2,
      title: "用户改过的歌名",
      bvid: "BV1xx411c7mD",
      cid: "987654",
      page: 32,
      partTitle: "02 あの日に帰りたい",
      source: "online",
    });

    const modalData = toLocalFavoriteModalData(item);
    expect(modalData).toMatchObject({
      rid: "987654",
      type: 2,
      fromLocalFavorite: true,
      itemInfo: {
        title: "用户改过的歌名",
        bvid: "BV1xx411c7mD",
        cid: "987654",
        page: 32,
        partTitle: "02 あの日に帰りたい",
        source: "online",
      },
    });

    expect(
      resolveLocalFavoriteSelection({
        rid: modalData.rid,
        itemInfo: modalData.itemInfo,
        preserveExistingPage: true,
      }),
    ).toEqual({
      localRid: "987654",
      title: "用户改过的歌名",
      duration: undefined,
      cid: "987654",
      page: 32,
      partTitle: "02 あの日に帰りたい",
    });
  });

  test("普通收藏选择整个视频时不沿用当前播放分集 cid", () => {
    expect(
      resolveLocalFavoriteSelection({
        rid: 123,
        itemInfo: { title: "原稿标题", cid: "987654", page: 32, partTitle: "P32" },
        preserveExistingPage: false,
      }),
    ).toMatchObject({ localRid: 123, title: "原稿标题", cid: undefined, page: undefined, partTitle: undefined });
  });
});
