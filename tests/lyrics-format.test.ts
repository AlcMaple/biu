import { describe, expect, it } from "vitest";

import {
  LyricsFormatError,
  parseKrcText,
  parseLrcText,
  parseTtmlText,
  parseTtmlTime,
  toLrc,
} from "@shared/lyrics-format";

describe("parseLrcText", () => {
  it("用下一行开始补行结束，并标明是推断的", () => {
    const lyrics = parseLrcText("[ti:歌名]\n[00:01.50]第一句\n[00:03.00]\n[00:04.2]第二句");
    expect(lyrics.timing).toBe("line");
    expect(lyrics.lines).toEqual([
      { startMs: 1500, endMs: 3000, endInferred: true, text: "第一句" },
      { startMs: 4200, endMs: 9200, endInferred: true, text: "第二句" },
    ]);
  });

  it("按时间戳合并译文，「//」占位不算译文", () => {
    const lyrics = parseLrcText("[00:01.00]a\n[00:02.00]b", "[00:01.00]甲\n[00:02.00]//");
    expect(lyrics.lines.map(line => line.translation)).toEqual(["甲", undefined]);
  });

  it("纯文本不会被当成带时间的歌词", () => {
    expect(() => parseLrcText("只是一段文字\n没有时间")).toThrow(LyricsFormatError);
  });
});

describe("parseKrcText", () => {
  const language = btoa(
    String.fromCharCode(
      ...new TextEncoder().encode(JSON.stringify({ content: [{ type: 1, lyricContent: [["译一"], ["译二"]] }] })),
    ),
  );

  it("字时间是相对行首的偏移，保留原生结束时间和逐行译文", () => {
    const lyrics = parseKrcText(
      `[ar:歌手]\n[language:${language}]\n[1000,800]<0,300,0>晴<300,500,0>天\n[2000,600]<0,600,0>雨`,
    );
    expect(lyrics.timing).toBe("word");
    expect(lyrics.lines[0]).toEqual({
      startMs: 1000,
      endMs: 1800,
      text: "晴天",
      translation: "译一",
      words: [
        { startMs: 1000, endMs: 1300, text: "晴" },
        { startMs: 1300, endMs: 1800, text: "天" },
      ],
    });
    expect(lyrics.lines[1].translation).toBe("译二");
  });

  it("没有带时间的行时报错", () => {
    expect(() => parseKrcText("[ar:歌手]")).toThrow(LyricsFormatError);
  });
});

describe("parseTtmlText", () => {
  const wrap = (body: string, ttAttrs = "") =>
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"${ttAttrs}><body><div>${body}</div></body></tt>`;

  it("读出逐字时间、词间空格、译文、罗马音、和声与演唱者", () => {
    const lyrics = parseTtmlText(
      wrap(
        `<p begin="00:01.000" end="00:03.000" ttm:agent="v2">` +
          `<span begin="00:01.000" end="00:01.500">Hello</span> <span begin="00:01.500" end="00:02.000">world</span>` +
          `<span ttm:role="x-translation" xml:lang="zh-CN">你好 &amp; 世界</span>` +
          `<span ttm:role="x-roman">ha-ro</span>` +
          `<span ttm:role="x-bg"><span begin="00:02.000" end="00:02.500">(oh)</span></span></p>`,
      ),
    );
    expect(lyrics.timing).toBe("word");
    expect(lyrics.lines[0]).toEqual({
      startMs: 1000,
      endMs: 3000,
      agent: "v2",
      text: "Hello world",
      translation: "你好 & 世界",
      romanization: "ha-ro",
      words: [
        { startMs: 1000, endMs: 1500, text: "Hello " },
        { startMs: 1500, endMs: 2000, text: "world" },
      ],
      background: { text: "(oh)", words: [{ startMs: 2000, endMs: 2500, text: "(oh)" }] },
    });
  });

  it("只有行时间的 TTML 按行时间输出", () => {
    const lyrics = parseTtmlText(wrap(`<p begin="1.5s" end="2500ms">整行</p>`));
    expect(lyrics.timing).toBe("line");
    expect(lyrics.lines[0]).toEqual({ startMs: 1500, endMs: 2500, text: "整行" });
  });

  it("拒绝 DTD、未闭合标签和未实现的时间语义，而不是悄悄错时", () => {
    expect(() => parseTtmlText(`<!DOCTYPE tt [<!ENTITY a "b">]>${wrap("")}`)).toThrow(LyricsFormatError);
    expect(() => parseTtmlText(`<tt><body><p begin="1s" end="2s">x</body></tt>`)).toThrow(LyricsFormatError);
    expect(() => parseTtmlText(wrap(`<p begin="1s" end="2s">x</p>`, ' ttp:timeBase="smpte"'))).toThrow(
      expect.objectContaining({ unsupported: true }),
    );
    expect(() => parseTtmlText(wrap(`<p begin="1f" end="2s">x</p>`))).toThrow(
      expect.objectContaining({ unsupported: true }),
    );
  });

  it("解析各种时钟值", () => {
    expect(parseTtmlTime("01:02:03.5")).toBe(3_723_500);
    expect(parseTtmlTime("03:30.429")).toBe(210_429);
    expect(parseTtmlTime("12.25")).toBe(12_250);
    expect(parseTtmlTime("0.5m")).toBe(30_000);
  });
});

describe("toLrc", () => {
  it("输出行级 LRC，译文单独一份", () => {
    const lyrics = parseLrcText("[01:02.03]原文", "[01:02.03]译文");
    expect(toLrc(lyrics)).toBe("[01:02.030]原文");
    expect(toLrc(lyrics, "translation")).toBe("[01:02.030]译文");
  });
});
