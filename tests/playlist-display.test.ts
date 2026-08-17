import { describe, expect, test } from "vitest";

import { getPlayListDisplayKey, isSamePlayListDisplayItem } from "@/common/utils/playlist-display";

describe("播放列表抽屉的展示身份", () => {
  test("同一 bvid 的不同分集不能互相去重", () => {
    const opening = { id: "1", type: "mv" as const, bvid: "BV1bFTB6GEjW", cid: "40207256866" };
    const ending = { id: "2", type: "mv" as const, bvid: "BV1bFTB6GEjW", cid: "40207257017" };

    expect(getPlayListDisplayKey(opening)).not.toBe(getPlayListDisplayKey(ending));
    expect(isSamePlayListDisplayItem(opening, ending)).toBe(false);
  });

  test("完全相同的分集仍视为同一项", () => {
    const first = { id: "1", type: "mv" as const, bvid: "BV1bFTB6GEjW", cid: "40207256866" };
    const second = { id: "2", type: "mv" as const, bvid: "BV1bFTB6GEjW", cid: "40207256866" };

    expect(isSamePlayListDisplayItem(first, second)).toBe(true);
  });
});
