import { describe, expect, it, vi } from "vitest";

import { looksLikeTianci, matchesScreenOrigin, screenOriginOf } from "@/components/lyrics/tianci";
import { aiSubtitleTarget, fetchAiSubtitle } from "@shared/bilibili-subtitle";

describe("填词歌判定", () => {
  it.each([
    ["【原神】欧气分你一半！抽卡专用曲！（原曲：锦鲤抄）", true],
    ["【填词】搞cp抄", true],
    ["填翻 | 牵丝戏", true],
    ["改词版 回马枪", true],
    ["周杰伦 - 晴天", false],
    ["【翻唱】红莲华", false],
  ])("%s → %s", (title, expected) => {
    expect(looksLikeTianci(title)).toBe(expected);
  });
});

describe("歌词来源跟着歌词文字走", () => {
  const origin = screenOriginOf("screen", "[00:01.00]欧气分你一半\n[00:03.00]祝你幸福美满");
  it("同一份歌词（含对齐后去掉时间标签）认得出来", () => {
    expect(
      matchesScreenOrigin(
        [
          { time: 1000, text: "欧气分你一半" },
          { time: 3000, text: "祝你幸福美满" },
        ],
        origin,
      ),
    ).toBe(true);
  });
  it("换了歌词就不再算", () => {
    expect(matchesScreenOrigin([{ time: 0, text: "别的歌词" }], origin)).toBe(false);
    expect(matchesScreenOrigin([], origin)).toBe(false);
  });
});

describe("AI 字幕地址白名单", () => {
  it.each([
    "//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/7340084301234abcd?auth_key=1700000000-abc-0-def",
    "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/7340084301234abcd",
  ])("放行 %s", raw => {
    expect(aiSubtitleTarget(raw)?.origin).toBe("https://aisubtitle.hdslb.com");
  });

  it.each([
    "https://evil.example/bfs/ai_subtitle/prod/1",
    "https://aisubtitle.hdslb.com.evil.example/bfs/ai_subtitle/prod/1",
    "https://aisubtitle.hdslb.com/bfs/other/1",
    "https://aisubtitle.hdslb.com/bfs/ai_subtitle/../../x",
    "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1?auth_key=1&next=https://evil.example",
    "https://user@aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1",
    "http://aisubtitle.hdslb.com:8080/bfs/ai_subtitle/prod/1",
    "not a url",
  ])("拒绝 %s", raw => {
    expect(aiSubtitleTarget(raw)).toBeNull();
  });

  it("取到字幕只留每行文字和起止时间；HTTP 失败带回状态码，不重试", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        text: JSON.stringify({ body: [{ from: 1, to: 2, content: "你好", sid: 1, location: 2 }, { bad: true }] }),
      })
      .mockResolvedValueOnce({ status: 412, text: "" });
    const raw = "//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1?auth_key=1-a-0-b";
    expect(await fetchAiSubtitle(transport, raw)).toEqual({ ok: true, lines: [{ from: 1, to: 2, content: "你好" }] });
    expect(await fetchAiSubtitle(transport, raw)).toEqual({ ok: false, reason: "http", status: 412 });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(await fetchAiSubtitle(transport, "https://evil.example/x")).toEqual({ ok: false, reason: "invalid-url" });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
