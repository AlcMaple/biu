import { describe, expect, it } from "vitest";

import { resolveLocateIndex } from "../src/common/utils/locate-playing";

const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
const base = {
  allItems: items,
  shownItems: items,
  isCurrent: (i: { id: number }) => i.id === 2,
  folderLabel: "收藏夹",
};

describe("resolveLocateIndex", () => {
  it("没有正在播放的歌曲时给出对应提示", () => {
    expect(resolveLocateIndex({ ...base, playItem: undefined })).toEqual({ message: "当前没有正在播放的歌曲" });
  });

  it("命中展示列表时返回下标", () => {
    expect(resolveLocateIndex({ ...base, playItem: {} })).toEqual({ index: 1 });
  });

  it("被筛选隐藏与不在歌单里是两种不同的提示", () => {
    const hidden = resolveLocateIndex({ ...base, playItem: {}, shownItems: [items[0]] });
    const absent = resolveLocateIndex({ ...base, playItem: {}, allItems: [items[0]], shownItems: [items[0]] });
    expect(hidden).toEqual({ message: "当前播放的歌曲被搜索或标签筛选隐藏了，清除筛选后再试" });
    expect(absent).toEqual({ message: "当前播放的歌曲不在这个收藏夹里" });
  });
});
