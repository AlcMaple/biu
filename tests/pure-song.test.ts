import { describe, expect, it } from "vitest";

import { isPureSongCandidate, isSameSong, songKey, toSeconds, type SongCandidate } from "@/common/utils/pure-song";

const base: SongCandidate = {
  bvid: "BV1xx",
  title: "周杰伦 - 晴天",
  durationSec: 210,
};

describe("toSeconds", () => {
  it("parses mm:ss and hh:mm:ss and raw numbers", () => {
    expect(toSeconds("3:20")).toBe(200);
    expect(toSeconds("1:02:33")).toBe(3753);
    expect(toSeconds(180)).toBe(180);
    expect(toSeconds(undefined)).toBe(0);
    expect(toSeconds("bad")).toBe(0);
  });
});

describe("isPureSongCandidate", () => {
  it("accepts a normal single song", () => {
    expect(isPureSongCandidate(base)).toBe(true);
  });

  it("rejects out-of-window durations", () => {
    expect(isPureSongCandidate({ ...base, durationSec: 30 })).toBe(false); // 太短，切片
    expect(isPureSongCandidate({ ...base, durationSec: 2500 })).toBe(false); // 41 分钟循环歌单
  });

  it("rejects compilation / talk / reaction titles", () => {
    for (const title of [
      "循环歌单|【告白气球】",
      "华语经典串烧50首",
      "【路人re】苏新皓朱志鑫同舞台直拍对比",
      "reaction 第一次听",
      "让日本萝莉听《派对浪客诸葛孔明》OP会有什么反应",
      "给老外听周杰伦，他会有怎样的反应？",
      "韩国音乐人第一次听《孤勇者》",
      "听完 YOASOBI 新歌后的反應",
      "电吉他改装爱好者必看！拾音器测评",
      "【偶像活动】星宫莓 雾矢葵 初同台 アイドル活動！",
      "THE FIRST TAKE / 优里 - 大提灯",
    ]) {
      expect(isPureSongCandidate({ ...base, title, durationSec: 210 })).toBe(false);
    }
  });

  it("rejects blocked subareas (live / radio)", () => {
    expect(isPureSongCandidate({ ...base, tname: "音乐现场" })).toBe(false);
    expect(isPureSongCandidate({ ...base, tname: "电台" })).toBe(false);
  });

  it("accepts allowed subareas", () => {
    expect(isPureSongCandidate({ ...base, tname: "翻唱" })).toBe(true);
    expect(isPureSongCandidate({ ...base, tname: "MV" })).toBe(true);
  });

  it("keeps normal song titles containing 听 or 反应", () => {
    for (const title of ["张学友 - 听海", "让我听懂你的语言", "化学反应 - 蔡依林", "第一次听见你"]) {
      expect(isPureSongCandidate({ ...base, title })).toBe(true);
    }
  });

  it("rejects when bvid is missing", () => {
    expect(isPureSongCandidate({ ...base, bvid: "" })).toBe(false);
  });
});

describe("同名去重 songKey / isSameSong", () => {
  it("folds the same song uploaded with different decorated titles (图1 case)", () => {
    const a = songKey("カレンダーガール (Calendar Girl) — 星宮莓 x 霧矢葵 | 歌词分配 | 中字");
    const b = songKey("[中字] カレンダーガール");
    expect(isSameSong(a, b)).toBe(true);
  });

  it("folds live/cover variants of one song", () => {
    expect(isSameSong(songKey("晴天"), songKey("晴天 (Live)"))).toBe(true);
    expect(isSameSong(songKey("カレンダーガール"), songKey("【中字】カレンダーガール 完整版"))).toBe(true);
  });

  it("keeps different songs distinct", () => {
    expect(isSameSong(songKey("晴天"), songKey("稻香"))).toBe(false);
    expect(isSameSong(songKey("カレンダーガール"), songKey("エメラルドの魔法"))).toBe(false);
  });
});
