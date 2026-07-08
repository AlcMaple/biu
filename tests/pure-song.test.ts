import { describe, expect, it } from "vitest";

import { isPureSongCandidate, toSeconds, type SongCandidate } from "@/common/utils/pure-song";

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
      "电吉他改装爱好者必看！拾音器测评",
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

  it("rejects when bvid is missing", () => {
    expect(isPureSongCandidate({ ...base, bvid: "" })).toBe(false);
  });
});
