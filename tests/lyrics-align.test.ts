import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));

vi.mock("@/platform", () => ({
  default: {
    getStore: vi.fn(async (name: string) => store.data[name]),
    setStore: vi.fn(async (name: string, value: unknown) => {
      // 与 electron-store / Preferences 一样按 JSON 落盘，undefined 字段会消失
      store.data[name] = JSON.parse(JSON.stringify(value));
    }),
  },
}));

import { adoptAlignment, isUserChosen, restorePreAlign } from "@/components/lyrics/alignment";
import { findActiveIndex } from "@/components/lyrics/playback-clock";
import { matchAlignRoute, normalizeAlignServerUrl } from "@shared/lyrics-align";
import { StoreNameMap } from "@shared/store";

const alignment = (lines: [number, string][]): LyricsAlignment => ({
  alignerVersion: 1,
  bvid: "BV13LFNzmEHG",
  cid: "1",
  lyricsHash: "h1",
  video: { title: "跳楼机", durationSec: 200 },
  lines: lines.map(([start, text]) => ({
    start,
    text,
    score: 0.5,
    words: [...text].map((c, i) => ({ text: c, start: start + i * 0.2 })),
  })),
  quality: { medianScore: 0.5, lowScoreLines: 0, repairedLines: 0 },
  offsetSec: 0.3,
  lrc: "",
  createdAt: 0,
});

const cache = () => store.data[StoreNameMap.LyricsCache] as Record<string, MusicLyrics>;

describe("align route whitelist", () => {
  it("only lets known paths through, with auth where the server requires it", () => {
    expect(matchAlignRoute("GET", "/lyrics/BV13LFNzmEHG/123")).toEqual({ auth: false });
    expect(matchAlignRoute("POST", "/align/jobs")).toEqual({ auth: true });
    expect(matchAlignRoute("GET", "/align/jobs/0b5e7f3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b")).toEqual({ auth: true });
    expect(matchAlignRoute("GET", "/admin/submissions?status=pending")).toEqual({ auth: true });
    expect(matchAlignRoute("GET", "/align/jobs/../../health")).toBeUndefined();
    expect(matchAlignRoute("GET", "/admin/submissions?status=pending&x=1")).toBeUndefined();
    expect(matchAlignRoute("POST", "/me")).toBeUndefined();
  });

  it("falls back to the default server for bad or plain-HTTP remote addresses", () => {
    expect(normalizeAlignServerUrl("")).toBe("https://biu.alcmaple.cn/align");
    expect(normalizeAlignServerUrl("http://127.0.0.1:3003/api/")).toBe("http://127.0.0.1:3003/api");
    expect(normalizeAlignServerUrl("http://evil.example/api")).toBe("https://biu.alcmaple.cn/align");
  });
});

describe("adopting and restoring an alignment", () => {
  beforeEach(() => {
    store.data = {
      [StoreNameMap.LyricsCache]: {
        "BV13LFNzmEHG-1": {
          offset: 120,
          lyrics: "[00:10.00]第一句\n[00:15.00]第二句",
          tLyrics: "[00:10.00]first\n[00:15.00]second",
          source: "manual",
        },
      },
    };
  });

  it("keeps the original for restore and moves translations to the aligned times", async () => {
    const { lines, tLines } = await adoptAlignment(
      "BV13LFNzmEHG-1",
      alignment([
        [10.3, "第一句"],
        [15.42, "第二句"],
      ]),
      "aligned",
    );
    expect(lines.map(l => l.time)).toEqual([10300, 15420]);
    expect(lines[1].words?.[1]).toEqual({ text: "二", time: 15620 });
    expect(tLines).toEqual([
      { time: 10300, text: "first" },
      { time: 15420, text: "second" },
    ]);
    const entry = cache()["BV13LFNzmEHG-1"];
    // 手动偏移是在补原歌词的误差，对齐后归零；原值留给还原
    expect(entry).toMatchObject({ source: "aligned", offset: 0, alignment: { lyricsHash: "h1" } });
    expect(entry.preAlign).toMatchObject({ offset: 120 });
    expect(entry.preAlign?.lyrics).toContain("[00:10.00]第一句");
    expect(isUserChosen(entry)).toBe(true);

    // 再采用一次（比如审核版本）也不能把 preAlign 覆盖成上一次的对齐结果
    await adoptAlignment("BV13LFNzmEHG-1", alignment([[11, "第一句"]]), "approved");
    expect(cache()["BV13LFNzmEHG-1"].preAlign?.lyrics).toContain("[00:10.00]第一句");

    const restored = await restorePreAlign("BV13LFNzmEHG-1");
    expect(restored?.lines.map(l => l.time)).toEqual([10000, 15000]);
    expect(restored?.offset).toBe(120);
    const after = cache()["BV13LFNzmEHG-1"];
    expect(after.alignment).toBeUndefined();
    expect(after.preAlign).toBeUndefined();
    expect(after.source).toBe("manual");
    expect(after.offset).toBe(120);
  });

  it("treats approved and auto-matched lyrics as replaceable, user choices as not", () => {
    expect(isUserChosen(undefined)).toBe(false);
    expect(isUserChosen({ lyrics: "x", source: "auto" })).toBe(false);
    expect(isUserChosen({ lyrics: "x", source: "approved" })).toBe(false);
    expect(isUserChosen({ lyrics: "x" })).toBe(true);
    expect(isUserChosen({ offset: 100 })).toBe(false);
  });
});

describe("active lyric line", () => {
  it("switches exactly at the line start", () => {
    const lines = [
      { time: 1000, text: "a" },
      { time: 2000, text: "b" },
    ];
    expect(findActiveIndex(lines, 1999)).toBe(0);
    expect(findActiveIndex(lines, 2000)).toBe(1);
    expect(findActiveIndex([], 2000)).toBe(-1);
  });
});
