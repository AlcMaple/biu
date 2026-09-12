import { describe, expect, test } from "vitest";

import type { LocalFavItem } from "@/store/local-fav-items";
import type { PlayData } from "@/store/play-list";

import {
  toPlaybackFavoriteModalData,
  toLocalFavoriteModalData,
  resolveLocalFavoriteSelection,
} from "@/common/utils/fav";
import { getItemTagKey } from "@/store/tags";

const part: LocalFavItem = {
  rid: "987654",
  cid: "987654",
  bvid: "BV1xx411c7mD",
  type: 2,
  source: "online",
  title: "用户的歌名",
  page: 2,
  partTitle: "第二集",
  duration: 237,
  fav_time: 1,
};
const playing: PlayData = {
  id: "queue-1",
  type: "mv",
  bvid: part.bvid,
  aid: "123",
  cid: part.cid,
  title: "上游标题",
  pageTitle: part.title,
};

describe("播放入口收藏身份", () => {
  test("播放栏与列表使用相同条目、标题、分集和标签键", () => {
    const modal = toPlaybackFavoriteModalData(playing, [part]);
    expect(modal).toEqual(toLocalFavoriteModalData(part));
    expect(modal).toBeDefined();
    const selection = resolveLocalFavoriteSelection({
      rid: modal!.rid,
      itemInfo: modal!.itemInfo!,
      preserveExistingPage: true,
    });
    expect(selection).toMatchObject({ localRid: part.rid, cid: part.cid, title: part.title, page: 2 });
    expect(getItemTagKey({ rid: modal!.rid, type: modal!.type, ...modal!.itemInfo })).toBe(getItemTagKey(part));
    const items = [part];
    if (!items.some(item => String(item.rid) === String(selection.localRid)))
      items.push({ ...part, rid: selection.localRid });
    expect(items).toHaveLength(1);
  });

  test("同视频其他分集不算当前分集已收藏", () => {
    const modal = toPlaybackFavoriteModalData({ ...playing, cid: "other" }, [part]);
    expect(modal?.fromLocalFavorite).not.toBe(true);
    expect(modal?.rid).toBe("123");
  });

  test("优先精确分集，不被前面的整稿或相同数值的在线音频误命中", () => {
    const whole = { ...part, cid: undefined, rid: "123" };
    const audio = { ...part, type: 12, ownerName: "歌手", rid: "123", cid: undefined };
    expect(toPlaybackFavoriteModalData(playing, [audio, whole, part])).toEqual(toLocalFavoriteModalData(part));
  });

  test("整稿收藏保留原有 rid，不把播放时补出的 cid 写成新分集", () => {
    const whole = { ...part, rid: "123", cid: undefined, page: undefined, partTitle: undefined };
    expect(toPlaybackFavoriteModalData(playing, [whole])).toEqual(toLocalFavoriteModalData(whole));
  });

  test("未收藏的普通视频仍走在线选集流程", () => {
    const modal = toPlaybackFavoriteModalData(playing, []);
    expect(modal?.fromLocalFavorite).not.toBe(true);
    expect(modal).toMatchObject({ rid: "123", type: 2, itemInfo: { cid: part.cid } });
    expect(
      resolveLocalFavoriteSelection({ rid: modal!.rid, itemInfo: modal!.itemInfo!, preserveExistingPage: false }).cid,
    ).toBeUndefined();
  });

  test("本地文件与在线音频数值相同也不串收藏", () => {
    const local = { ...part, rid: "12", type: 12, source: "local" as const, cid: undefined, bvid: undefined };
    const audio = { ...local, source: "online" as const, ownerName: "歌手" };
    expect(
      toPlaybackFavoriteModalData({ id: "12", source: "local", type: "audio", title: "本地" }, [audio, local]),
    ).toEqual(toLocalFavoriteModalData(local));
    expect(toPlaybackFavoriteModalData({ id: "queue", sid: 12, type: "audio", title: "在线" }, [local, audio])).toEqual(
      toLocalFavoriteModalData(audio),
    );
  });
});
