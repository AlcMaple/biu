import { describe, expect, it } from "vitest";

import {
  karaokeTiming,
  LAST_WORD_MAX_MS,
  splitUnits,
  SYNTH_LAST_LINE_MS,
  wordProgress,
} from "@/components/lyrics/karaoke";

describe("splitting a lyric line into karaoke units", () => {
  it("splits CJK per character and Latin per word, folding spaces and punctuation into the previous unit", () => {
    expect(splitUnits("在东京铁塔")).toEqual(["在", "东", "京", "铁", "塔"]);
    expect(splitUnits("Hello world, 你好！")).toEqual(["Hello ", "world, ", "你", "好！"]);
    expect(splitUnits("「第一次」眺望")).toEqual(["「第", "一", "次」", "眺", "望"]);
    expect(splitUnits("   ")).toEqual([]);
  });
});

describe("timing for lines without per-word data", () => {
  it("spreads the line evenly up to the next line", () => {
    const { words, end } = karaokeTiming({ time: 1000, text: "一二三四" }, 3000);
    expect(words.map(w => w.time)).toEqual([1000, 1500, 2000, 2500]);
    expect(end).toBe(3000);
  });

  it("keeps filling until the next line even before a long interlude, like the original line timing", () => {
    const { words, end } = karaokeTiming({ time: 0, text: "一二三" }, 21_000);
    expect(words.map(w => w.time)).toEqual([0, 7000, 14_000]);
    expect(end).toBe(21_000);
  });

  it("gives the last line, which has no next line, a fixed span", () => {
    expect(karaokeTiming({ time: 1000, text: "一二" }).end).toBe(1000 + SYNTH_LAST_LINE_MS);
  });
});

describe("timing for aligned lines", () => {
  const line = {
    time: 0,
    text: "你好",
    words: [
      { text: "你", time: 0 },
      { text: "好", time: 400 },
    ],
  };

  it("keeps the real word starts and fills the last word for at most a fixed time", () => {
    expect(karaokeTiming(line, 10_000).end).toBe(400 + LAST_WORD_MAX_MS);
    expect(karaokeTiming(line, 900).end).toBe(900);
  });

  it("fills each word from its start to the next word's start", () => {
    const timing = karaokeTiming(line, 10_000);
    expect(wordProgress(timing, 200)).toEqual([0.5, 0]);
    expect(wordProgress(timing, 400 + LAST_WORD_MAX_MS / 2)).toEqual([1, 0.5]);
  });
});
