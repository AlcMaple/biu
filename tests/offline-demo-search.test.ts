import { describe, expect, it } from "vitest";

import { DEMO_VIDEOS, offlineDemoResponse } from "@/common/offline-demo-fixtures";

const search = (params: Record<string, unknown> | URLSearchParams) =>
  offlineDemoResponse({ url: "/x/web-interface/wbi/search/type", params }) as {
    data: {
      numResults: number;
      numPages: number;
      result: { bvid: string; title: string; author: string }[];
    };
  };

describe("offline demo video search", () => {
  it("matches a title instead of returning the whole catalogue", () => {
    const { data } = search({ keyword: "Apologize", search_type: "video" });

    expect(data.result.map(item => item.title)).toEqual(["【英语】百万级装备听《Apologize》"]);
    expect(data.numResults).toBe(1);
    expect(data.numPages).toBe(1);
  });

  it("matches the uploader name", () => {
    const { data } = search({ keyword: "OneRepublic" });

    expect(data.result).toHaveLength(2);
    expect(data.result.every(item => item.author === "OneRepublic")).toBe(true);
  });

  it("matches all words across the title and uploader without case sensitivity", () => {
    const { data } = search({ keyword: "  oNeRePuBliC \n APOLOGIZE  " });

    expect(data.result.map(item => item.title)).toEqual(["【英语】百万级装备听《Apologize》"]);
  });

  it("accepts URLSearchParams used by request callers", () => {
    const { data } = search(new URLSearchParams({ keyword: "梦醒时分", search_type: "video" }));

    expect(data.result.map(item => item.title)).toEqual(["陈淑桦-梦醒时分（无损发烧版）"]);
  });

  it("returns an empty result and zero totals when nothing matches", () => {
    expect(search({ keyword: "zzzz-no-such-song-20261103" }).data).toMatchObject({
      result: [],
      numResults: 0,
      numPages: 0,
    });
  });

  it.each([{}, { keyword: "   \t " }])("preserves the catalogue when no keyword is supplied: %j", params => {
    const { data } = search(params);

    expect(data.result.map(item => item.bvid)).toEqual(DEMO_VIDEOS.map(item => item.bvid));
    expect(data.numResults).toBe(DEMO_VIDEOS.length);
  });
});
