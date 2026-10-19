import { describe, expect, it } from "vitest";

import { AlignError } from "../src/lib/errors.js";
import { lyricsHash, parseLyrics, parseTarget } from "../src/lib/lyrics.js";

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as AlignError).code;
  }
  return undefined;
};

describe("parseLyrics", () => {
  it("去掉网易云 JSON 制作人员行、元信息、中英文制作名单和 ISRC", () => {
    const raw = [
      '{"t":0,"c":[{"tx":"作词: "},{"tx":"姜洄"}]}',
      "[ti:跳楼机]",
      "[00:00.00] 作词 : 某某",
      "[00:01.00] Produced by Someone",
      "[00:16.24]再没资格拨通你电话",
      "[00:21.62]那一串简单号码",
      "[04:25.44] 录音室 : The Garden（新加坡）",
      "[05:10.55]ISRC TW-A45-99-62502",
    ].join("\n");
    expect(parseLyrics(raw).map(l => l.text)).toEqual(["再没资格拨通你电话", "那一串简单号码"]);
  });

  it("短前缀加冒号只在开头 / 结尾成片时删，夹在中间的是歌词", () => {
    const raw = [
      "[00:01]编曲助理：张三",
      "[00:10]第一句",
      "[00:20]他说：我爱你",
      "[00:30]最后一句",
      "[00:40]箫 : 林信有",
    ].join("\n");
    expect(parseLyrics(raw).map(l => l.text)).toEqual(["第一句", "他说：我爱你", "最后一句"]);
  });

  it("一行多个时间标签展开成多行并按时间排序", () => {
    const lines = parseLyrics("[00:30.00][01:30.00]副歌\n[00:10.00]主歌");
    expect(lines).toEqual([
      { t: 10, text: "主歌" },
      { t: 30, text: "副歌" },
      { t: 90, text: "副歌" },
    ]);
  });

  it("开头的「歌手 - 歌名」标题行去掉，逐字标签去掉", () => {
    const lines = parseLyrics("[00:00.50]周杰伦 - 晴天\n[00:29.36]<00:29.36>故<00:29.60>事");
    expect(lines).toEqual([{ t: 29.36, text: "故事" }]);
  });

  it("纯文本歌词时间为 0、保持原顺序", () => {
    expect(parseLyrics("第一句\n\n第二句")).toEqual([
      { t: 0, text: "第一句" },
      { t: 0, text: "第二句" },
    ]);
  });

  it("清洗后为空 / 过长给出对应错误码", () => {
    expect(codeOf(() => parseLyrics("[00:00]作词：某某\n"))).toBe("LYRICS_EMPTY");
    expect(codeOf(() => parseLyrics(Array.from({ length: 301 }, (_, i) => `第${i}句`).join("\n")))).toBe(
      "LYRICS_TOO_LONG",
    );
  });
});

describe("lyricsHash", () => {
  it("空白和换行风格不同但内容相同 → 同一个哈希；时间不同 → 不同", () => {
    const a = parseLyrics("[00:01.00]你好  世界\r\n[00:02.00]再见");
    const b = parseLyrics("[00:01.000] 你好 世界\n\n[00:02.00]再见\n");
    const c = parseLyrics("[00:01.50]你好 世界\n[00:02.00]再见");
    expect(lyricsHash(a)).toBe(lyricsHash(b));
    expect(lyricsHash(a)).not.toBe(lyricsHash(c));
  });
});

describe("parseTarget", () => {
  it("只接受合法 bvid / 数字 cid", () => {
    expect(parseTarget("BV13LFNzmEHG", 35772236733)).toEqual({ bvid: "BV13LFNzmEHG", cid: "35772236733" });
    expect(codeOf(() => parseTarget("BV1../../etc", "1"))).toBe("BAD_REQUEST");
    expect(codeOf(() => parseTarget("BV13LFNzmEHG", "1;rm"))).toBe("BAD_REQUEST");
  });
});
