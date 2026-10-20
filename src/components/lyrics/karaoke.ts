import type { LyricLine } from "@/store/lyrics-state";

export type KaraokeWord = { text: string; time: number };

export interface KaraokeTiming {
  words: KaraokeWord[];
  /** 最后一个单元填满的时刻（毫秒） */
  end: number;
}

// 没对齐过的歌词只有行时间，按字数从本行时间匀速摊到下一行开始，和接入对齐前桌面歌词的整行填色同一口径：
// 填色和原歌词的行时间一一对应，下一行开始时本行正好填满。
// 曾按 0.6 s/字封顶防长间奏前慢慢爬，结果约一半的行提前填满后整行亮着干等，看起来和原歌词对不上，已去掉。
// 最后一行没有下一行可参照，沿用当时的 5 s
export const SYNTH_LAST_LINE_MS = 5000;

// 对齐结果只有每个字的起点；最后一个字没有下一字可参照，按这么长填满，避免拖到下一行开始才填完
export const LAST_WORD_MAX_MS = 1200;

const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const ATTACHED = "\\s\\p{P}\\p{S}";
const TOKEN = new RegExp(`[${CJK}]|[^${CJK}${ATTACHED}]+|[${ATTACHED}]+`, "gu");
const IS_ATTACHED = new RegExp(`^[${ATTACHED}]+$`, "u");

// 中日韩按字、拉丁文按词切分；空格和标点并进前一个单元（开头的并进第一个），不单独占时间
export function splitUnits(text: string): string[] {
  const units: string[] = [];
  let leading = "";
  for (const token of text.match(TOKEN) ?? []) {
    if (!IS_ATTACHED.test(token)) {
      units.push(leading + token);
      leading = "";
    } else if (units.length) {
      units[units.length - 1] += token;
    } else {
      leading += token;
    }
  }
  return units;
}

export function karaokeTiming(line: LyricLine, nextTime?: number): KaraokeTiming {
  const limit = nextTime !== undefined && nextTime > line.time ? nextTime : Infinity;
  if (line.words?.length) {
    const last = line.words.at(-1)!;
    return { words: line.words, end: Math.min(limit, last.time + LAST_WORD_MAX_MS) };
  }
  const units = splitUnits(line.text);
  if (!units.length) return { words: [], end: line.time };
  const span = Number.isFinite(limit) ? limit - line.time : SYNTH_LAST_LINE_MS;
  const per = span / units.length;
  return {
    words: units.map((text, i) => ({ text, time: line.time + Math.round(i * per) })),
    end: line.time + Math.round(units.length * per),
  };
}

// 每个单元的填充进度 0~1：单元在下一个单元开始时填满，最后一个在 end 填满
export function wordProgress({ words, end }: KaraokeTiming, ms: number): number[] {
  return words.map((word, i) => {
    const until = words[i + 1]?.time ?? end;
    return Math.min(1, Math.max(0, (ms - word.time) / Math.max(1, until - word.time)));
  });
}
