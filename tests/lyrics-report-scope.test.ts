import { scopeText } from "@/components/lyrics-align-modal/report-scope";

describe("报错范围文案", () => {
  it("老记录没有轨和行号，按整首原文时间轴", () => {
    expect(scopeText({})).toBe("原文时间轴 · 整首");
  });

  it("译文 / 罗马音加上起止行", () => {
    expect(scopeText({ track: "translation", fromLine: 3, toLine: 8 })).toBe("译文 · 第 3–8 行");
    expect(scopeText({ track: "romanization", fromLine: 5, toLine: 5 })).toBe("罗马音 · 第 5 行");
  });
});
