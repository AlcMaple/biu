import { describe, expect, it } from "vitest";

import { bv2av, getFavoriteResourceRid, tryBv2av } from "@/common/utils/bv";
import { getItemTagIdsFromMap, getItemTagKey } from "@/store/tags";

const BVID = "BV1Q541167Qg";

describe("标签与歌曲身份绑定", () => {
  it("按来源、类型和分集区分相同数字 id", () => {
    const video = { rid: 42, type: 2, source: "online" as const, bvid: BVID };

    expect(getItemTagKey(video)).toBe(`video:bvid:${BVID}`);
    expect(getItemTagKey({ ...video, cid: 9001 })).toBe(`video:bvid:${BVID}:cid:9001`);
    expect(getItemTagKey({ rid: 42, type: 12, source: "online" })).toBe("audio:sid:42");
    expect(getItemTagKey({ rid: 42, type: 12, source: "local" })).toBe("local:42");
    expect(getItemTagKey(video)).not.toBe(getItemTagKey({ rid: "42", type: 12, source: "online" }));
  });

  it("规范键优先，旧版裸 rid 仍能读取", () => {
    const target = { rid: 42, type: 2, source: "online" as const, bvid: BVID };
    const key = getItemTagKey(target);

    expect(getItemTagIdsFromMap({ "42": [1], [key]: [2] }, target)).toEqual([2]);
    expect(getItemTagIdsFromMap({ "42": [1] }, target)).toEqual([1]);
  });

  it("播放栏缺少 aid 时从合法 bvid 推导收藏 id", () => {
    expect(tryBv2av(BVID)).toBe(bv2av(BVID));
    expect(getFavoriteResourceRid({ type: "mv", bvid: BVID })).toBe(String(bv2av(BVID)));
    expect(getFavoriteResourceRid({ type: "mv", aid: "123", bvid: BVID })).toBe("123");
    expect(getFavoriteResourceRid({ type: "audio", sid: 456 })).toBe("456");
    expect(getFavoriteResourceRid({ type: "mv", bvid: "invalid" })).toBeUndefined();
  });
});
