import { isCorrectionChanged, reportTracks, scopeText, trackLines } from "@/components/lyrics-align-modal/report-scope";

describe("报错范围文案", () => {
  it("老记录没有轨和行号，按整首原文时间轴", () => {
    expect(scopeText({})).toBe("原文歌词 · 整首");
  });

  it("译文 / 罗马音加上起止行", () => {
    expect(scopeText({ track: "translation", fromLine: 3, toLine: 8 })).toBe("译文 · 第 3–8 行");
    expect(scopeText({ track: "romanization", fromLine: 5, toLine: 5 })).toBe("罗马音 · 第 5 行");
  });
});

describe("报错能选的轨", () => {
  const lines = [{ translation: "译", romanization: "yi" }];

  it("中文歌只有原文，即使带了译文也不给选", () => {
    expect(reportTracks("zh", lines)).toEqual(["original"]);
  });

  it("英 / 韩有译文，日语再加罗马音", () => {
    expect(reportTracks("en", lines)).toEqual(["original", "translation"]);
    expect(reportTracks("ja", lines)).toEqual(["original", "translation", "romanization"]);
  });

  it("语种不明时看实际有什么；没有译文的日语歌不给选译文", () => {
    expect(reportTracks(undefined, lines)).toEqual(["original", "translation", "romanization"]);
    expect(reportTracks("ja", [{ romanization: "a" }])).toEqual(["original", "romanization"]);
  });

  it("其他错误显示类型", () => {
    expect(scopeText({ kind: "other", otherType: "audio" })).toBe("其他错误 · 音频错误");
  });
});

describe("报错时改歌词", () => {
  const lines = [
    { text: "夏の夜", translation: "夏夜", romanization: "natsu" },
    { text: "街の灯", romanization: "machi" },
  ];

  it("每一轨一行一句，缺的句子留空行，行号和原文对得上", () => {
    expect(trackLines(lines, "original")).toEqual(["夏の夜", "街の灯"]);
    expect(trackLines(lines, "translation")).toEqual(["夏夜", ""]);
  });

  it("没改、只多敲了空白或换行不算改过；清空也不算", () => {
    const original = trackLines(lines, "original");
    expect(isCorrectionChanged(original, "夏の夜\n街の灯")).toBe(false);
    expect(isCorrectionChanged(original, "夏の夜 \n街の灯\n\n")).toBe(false);
    expect(isCorrectionChanged(original, "  \n")).toBe(false);
    expect(isCorrectionChanged(original, "夏の夜\n街の光")).toBe(true);
  });

  it("带了改好歌词的报错显示附修改", () => {
    expect(scopeText({ track: "romanization", corrected: "x" })).toBe("罗马音 · 附修改后的歌词");
  });
});
