import { beforeEach, describe, expect, it } from "vitest";

import { useSearchHistory } from "@/store/search-history";

describe("搜索提交修订号", () => {
  beforeEach(() => {
    useSearchHistory.setState({ keyword: "", items: [], searchRevision: 0 });
  });

  it("重复提交同一关键词时仍递增修订号", () => {
    useSearchHistory.getState().add("螺旋");
    useSearchHistory.getState().add("螺旋");

    expect(useSearchHistory.getState().keyword).toBe("螺旋");
    expect(useSearchHistory.getState().searchRevision).toBe(2);
    expect(useSearchHistory.getState().items).toHaveLength(1);
  });

  it("不同关键词也沿用同一提交计数", () => {
    useSearchHistory.getState().add("螺旋");
    useSearchHistory.getState().add("晴天");

    expect(useSearchHistory.getState().searchRevision).toBe(2);
    expect(useSearchHistory.getState().items.map(item => item.value)).toEqual(["晴天", "螺旋"]);
  });
});
