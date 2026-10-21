import { describe, expect, it } from "vitest";

import { buildProviderAdoption, linesOfEntry, nativeLinesOf } from "@/components/lyrics/provider-lyrics";
import { parseKrcText, parseLrcText } from "@shared/lyrics-format";

const candidate = { provider: "kugou" as const, id: "H", title: "晴天", artists: ["周杰伦"] };

describe("buildProviderAdoption", () => {
  it("逐字歌词：行级 LRC 写进 lyrics，逐字时间单独存，来源元数据完整", () => {
    const lyrics = parseKrcText("[1000,800]<0,300,0>晴<300,500,0>天\n[2000,600]<0,600,0>雨");
    const adoption = buildProviderAdoption(
      { provider: "kugou", sourceId: "274944371", lyrics, author: "作者" },
      candidate,
      42,
    );
    expect(adoption.lyrics).toBe("[00:01.000]晴天\n[00:02.000]雨");
    expect(adoption.tLyrics).toBeUndefined();
    expect(adoption.origin).toEqual({
      provider: "kugou",
      sourceId: "274944371",
      title: "晴天",
      artists: ["周杰伦"],
      author: "作者",
      format: "krc",
      timing: "word",
      adoptedAt: 42,
    });
    expect(adoption.nativeTiming?.lines[0]).toEqual({
      startMs: 1000,
      endMs: 1800,
      words: [
        { startMs: 1000, endMs: 1300, text: "晴" },
        { startMs: 1300, endMs: 1800, text: "天" },
      ],
    });
  });

  it("逐行歌词不存逐字时间，译文单独一份", () => {
    const lyrics = parseLrcText("[00:01.00]a", "[00:01.00]甲");
    const adoption = buildProviderAdoption(
      { provider: "qq", sourceId: "mid", lyrics },
      { ...candidate, provider: "qq" },
    );
    expect(adoption.nativeTiming).toBeUndefined();
    expect(adoption.tLyrics).toBe("[00:01.000]甲");
  });
});

describe("nativeLinesOf", () => {
  const adoption = buildProviderAdoption(
    { provider: "kugou", sourceId: "1", lyrics: parseKrcText("[1000,800]<0,300,0>晴<300,500,0>天") },
    candidate,
  );

  it("lyrics 还是采用时那份：显示平台逐字时间", () => {
    expect(nativeLinesOf(adoption)).toEqual([
      {
        time: 1000,
        text: "晴天",
        words: [
          { text: "晴", time: 1000 },
          { text: "天", time: 1300 },
        ],
        nativeWords: true,
      },
    ]);
  });

  it("lyrics 被换掉后不再套用旧的逐字时间", () => {
    const entry = { lyrics: "[00:05.000]别的歌", nativeTiming: adoption.nativeTiming };
    expect(nativeLinesOf(entry)).toBeUndefined();
    expect(linesOfEntry(entry)).toEqual([{ time: 5000, text: "别的歌" }]);
  });
});
