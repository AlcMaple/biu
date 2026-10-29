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

  it("去掉日韩文制作人员行和整行的演唱者标注，保留真唱的括号伴唱", () => {
    const raw = [
      "[00:00.00] 作詞 : 米津玄師",
      "[00:01.00] 작사 : 아이유",
      "[00:10.00](The Kid LAROI)",
      "[00:11.00]I do the same thing I told you that I never would",
      "[00:15.00](The Kid LAROI & Justin Bieber)",
      "[00:16.00]Oh, ooh-woah (Oh, ooh-woah)",
      "[00:20.00](Oh, ooh-woah)",
      "[00:22.00](Ohhhhh Ohhh Ohhh)",
      "[00:24.00][Chorus]",
      "[00:25.00](Take that money)",
    ].join("\n");
    expect(parseLyrics(raw).map(l => l.text)).toEqual([
      "I do the same thing I told you that I never would",
      "Oh, ooh-woah (Oh, ooh-woah)",
      "(Oh, ooh-woah)",
      "(Ohhhhh Ohhh Ohhh)",
      "(Take that money)",
    ]);
  });

  it("合唱的演唱者标记留在原文里、单独标出来；开头就是标记行也不当制作名单删", () => {
    const raw = [
      "[00:01]作词：某某",
      "[00:10]藤：又是一个熬夜的晚上",
      "[00:12]一个人赶稿头发快掉光",
      "[00:20]薇：她们说我蛇蝎心肠",
      "[00:22]藤：我想那都是误会一场",
      "[00:24]薇：笑里藏刀 恶意中伤",
      "[00:26]藤：没被她骗 只是紧张",
      "[00:27]他说：我爱你",
      "[00:28]薇：天生丽质随便谁都能拿捏",
    ].join("\n");
    const lines = parseLyrics(raw);
    expect(lines.map(l => l.text)).toEqual([
      "藤：又是一个熬夜的晚上",
      "一个人赶稿头发快掉光",
      "薇：她们说我蛇蝎心肠",
      "藤：我想那都是误会一场",
      "薇：笑里藏刀 恶意中伤",
      "藤：没被她骗 只是紧张",
      "他说：我爱你",
      "薇：天生丽质随便谁都能拿捏",
    ]);
    expect(lines.map(l => l.tag ?? null)).toEqual(["藤：", null, "薇：", "藤：", "薇：", "藤：", null, "薇："]);
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

  it("同一时间的原文 / 译文 / 罗马音合成一句，只有原文参与对齐", () => {
    const raw = [
      "[00:10.00]雨に濡れた小道",
      "[00:10.00]Ame ni nureta komichi",
      "[00:10.00]雨后的小路泛着微光",
      "[00:14.00]足跡攫う時の波",
      "[00:14.00]足迹带走时间的波浪",
    ].join("\n");
    expect(parseLyrics(raw)).toEqual([
      { t: 10, text: "雨に濡れた小道", romanization: "Ame ni nureta komichi", translation: "雨后的小路泛着微光" },
      { t: 14, text: "足跡攫う時の波", translation: "足迹带走时间的波浪" },
    ]);
  });

  it("译文排在日文前面时仍以日文为原文", () => {
    const raw = "[00:10.00]雨后的小路\n[00:10.00]雨に濡れた小道";
    expect(parseLyrics(raw)).toEqual([{ t: 10, text: "雨に濡れた小道", translation: "雨后的小路" }]);
  });

  it("纯文本里日文 + 罗马音 + 译文成组出现时也合成一句", () => {
    const raw = [
      "雨に濡れた",
      "Ame ni nureta",
      "被雨淋湿",
      "足跡攫う",
      "Ashiato",
      "足迹",
      "季節を刻む",
      "Kisetsu",
      "刻下季节",
    ].join("\n");
    const lines = parseLyrics(raw);
    expect(lines.map(l => l.text)).toEqual(["雨に濡れた", "足跡攫う", "季節を刻む"]);
    expect(lines[0]).toMatchObject({ romanization: "Ame ni nureta", translation: "被雨淋湿" });
  });

  it("中文歌里零星的英文不会把后面的歌词吃成译文", () => {
    const raw = ["我爱你", "baby", "你好吗", "再见了", "我走了", "你要好好的"].join("\n");
    expect(parseLyrics(raw).map(l => l.text)).toEqual(["我爱你", "baby", "你好吗", "再见了", "我走了", "你要好好的"]);
  });

  it("英文原文后的拉丁字母行算译文，不是罗马音", () => {
    expect(parseLyrics("[00:10.00]I love you\n[00:10.00]Je t'aime")).toEqual([
      { t: 10, text: "I love you", translation: "Je t'aime" },
    ]);
  });

  it("译文变了哈希也变", () => {
    const a = parseLyrics("[00:10.00]雨に濡れた\n[00:10.00]被雨淋湿");
    const b = parseLyrics("[00:10.00]雨に濡れた\n[00:10.00]淋了雨");
    expect(lyricsHash(a)).not.toBe(lyricsHash(b));
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
