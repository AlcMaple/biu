import { describe, expect, it } from "vitest";

import { isPcdnUrl as sharedIsPcdn } from "../../shared/bilibili-stream.js";
import { isPcdnUrl } from "../src/lib/bilibili.js";
import { buildAlignment, looksMismatched, toLrc, toWords } from "../src/lib/result.js";

describe("toWords", () => {
  it("汉字一字一段，拉丁字母按词成段，标点和空格并进前一段，拼回来等于原文", () => {
    const line = {
      text: "baby 我们的感情，好像跳楼机",
      chars: [..."baby我们的感情好像跳楼机"],
      t: [1, 1.1, 1.2, 1.3, 2, 2.2, 2.4, 2.6, 2.8, 3, 3.2, 3.4, 3.6, 3.8],
      score: 0.3,
    };
    const words = toWords(line);
    expect(words.map(w => w.text)).toEqual(["baby ", "我", "们", "的", "感", "情，", "好", "像", "跳", "楼", "机"]);
    expect(words.map(w => w.start)).toEqual([1, 2, 2.2, 2.4, 2.6, 2.8, 3, 3.2, 3.4, 3.6, 3.8]);
    expect(words.map(w => w.text).join("")).toBe(line.text);
  });

  it("词中间的撇号留在词里，不把 I've 拆成两段", () => {
    const line = {
      text: "I've been, don't",
      chars: [..."Ivebeendont"],
      t: [1, 1.1, 1.1, 2, 2, 2, 2, 3, 3, 3, 3],
      score: 0.3,
    };
    const words = toWords(line);
    expect(words.map(w => w.text)).toEqual(["I've ", "been, ", "don't"]);
    expect(words.map(w => w.start)).toEqual([1, 2, 3]);
  });

  it("增强 LRC 行时间 + 每段时间", () => {
    expect(
      toLrc([
        {
          start: 65.5,
          text: "你好",
          words: [
            { text: "你", start: 65.5 },
            { text: "好", start: 66 },
          ],
          score: 1,
        },
      ]),
    ).toBe("[01:05.50]<01:05.50>你<01:06.00>好\n");
  });
});

describe("isPcdnUrl", () => {
  // 服务端为了单独打包复制了一份规则，这里保证两边不会改漏一边
  it.each([
    "https://upos-sz-mirrorcos.bilivideo.com/x.m4s?os=cosbv",
    "https://xy1x2x3x4xy.mcdn.bilivideo.cn:4483/x.m4s",
    "https://abc.edge.mountaintoys.cn:4483/x.m4s?os=mcdn",
    "https://abc.edge.example.cn/x.m4s?mcdnid=123",
    "https://x.szbdyd.com/x.m4s",
    "not a url",
  ])("%s 与 shared 版判定一致", url => {
    expect(isPcdnUrl(url)).toBe(sharedIsPcdn(url));
  });
});

describe("looksMismatched", () => {
  const q = (medianScore: number, repairedLines: number) => ({
    quality: { lang: "zh" as const, medianScore, repairedLines, lowScoreLines: 0, timelineMatch: null },
  });
  const fq = (lang: "ja" | "ko" | "en", medianScore: number, repairedLines: number, timelineMatch: number | null) => ({
    quality: { lang, medianScore, repairedLines, lowScoreLines: 0, timelineMatch },
  });
  it("外语按修复前行起点和原歌词时间的吻合度判（23 首对得上 / 11 组配错的实测边界）", () => {
    // 对得上但置信度很低、重对齐很多的英语歌（Shape of You）不能被中文规则误判
    expect(looksMismatched(fq("en", 0.119, 42, 0.89), true)).toBe(false);
    expect(looksMismatched(fq("en", 0.146, 6, 0.8), true)).toBe(false);
    expect(looksMismatched(fq("ja", 0.242, 22, 0.27), true)).toBe(true);
    expect(looksMismatched(fq("ko", 0.086, 25, 0.06), true)).toBe(true);
    // 外语纯文本歌词不判，交给人工审核
    expect(looksMismatched(fq("en", 0.05, 0, null), false)).toBe(false);
  });
  it("按 15 首对得上 / 4 组配错的实测边界判定", () => {
    expect(looksMismatched(q(0.277, 2), true)).toBe(false);
    expect(looksMismatched(q(0.215, 4), true)).toBe(true);
    expect(looksMismatched(q(0.161, 6), true)).toBe(true);
    // 只低分或只修得多都不判错
    expect(looksMismatched(q(0.2, 1), true)).toBe(false);
    expect(looksMismatched(q(0.35, 5), true)).toBe(false);
    expect(looksMismatched(q(0.19, 0), false)).toBe(true);
    expect(looksMismatched(q(0.215, 0), false)).toBe(false);
  });
});

describe("buildAlignment", () => {
  it("演唱者标记接回行首，在第一个字唱出前逐字点亮完，不越过上一行", () => {
    const page = { bvid: "BV1a68z6GELa", cid: "1", title: "素演", part: "", durationSec: 214, audio: [] } as never;
    const out = buildAlignment(
      { bvid: "BV1a68z6GELa", cid: "1", lyricsHash: "h" },
      page,
      [
        { t: 1, text: "合：想被骗", tag: "合：" },
        { t: 3, text: "别说骗" },
      ],
      {
        lang: "zh",
        offset: 0,
        frameMs: 20,
        timelineMatch: 1,
        lines: [
          { text: "想被骗", chars: ["想", "被", "骗"], t: [1.2, 1.5, 1.8], score: 0.5 },
          { text: "别说骗", chars: ["别", "说", "骗"], t: [3.1, 3.4, 3.7], score: 0.5 },
        ],
      },
    );
    expect(out.lines[0]).toMatchObject({
      start: 0.9,
      text: "合：想被骗",
      words: [
        { text: "合", start: 0.9 },
        { text: "：", start: 1.05 },
        { text: "想", start: 1.2 },
        { text: "被", start: 1.5 },
        { text: "骗", start: 1.8 },
      ],
    });
    expect(out.lines[1].text).toBe("别说骗");
    const tight = buildAlignment(
      { bvid: "BV1a68z6GELa", cid: "1", lyricsHash: "h" },
      page,
      [
        { t: 1, text: "想被骗" },
        { t: 3, text: "合：别说骗", tag: "合：" },
      ],
      {
        lang: "zh",
        offset: 0,
        frameMs: 20,
        timelineMatch: 1,
        lines: [
          { text: "想被骗", chars: ["想", "被", "骗"], t: [1.2, 1.5, 3.0], score: 0.5 },
          { text: "别说骗", chars: ["别", "说", "骗"], t: [3.1, 3.4, 3.7], score: 0.5 },
        ],
      },
    );
    expect(tight.lines[1].words.slice(0, 3)).toEqual([
      { text: "合", start: 3 },
      { text: "：", start: 3.05 },
      { text: "别", start: 3.1 },
    ]);
  });
});
