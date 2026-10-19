import type { VideoPage } from "./bilibili.js";
import type { LyricLine } from "./lyrics.js";

// 算法有实质改动（参数、门控、分块方式）时加一，旧缓存自动失效
export const ALIGNER_VERSION = 1;

export interface WorkerLine {
  text: string;
  chars: string[];
  t: number[];
  score: number;
  repaired?: boolean;
}

export interface WorkerOutput {
  lines: WorkerLine[];
  offset: number;
  frameMs: number;
}

// 客户端按 words 逐段点亮：每段是一个汉字或一个拉丁词，标点和空格并进前一段，拼起来就是原文
export interface AlignedLine {
  start: number;
  text: string;
  words: { text: string; start: number }[];
  score: number;
  repaired?: true;
}

export interface Alignment {
  alignerVersion: number;
  bvid: string;
  cid: string;
  lyricsHash: string;
  video: Pick<VideoPage, "title" | "part" | "durationSec">;
  lines: AlignedLine[];
  quality: { medianScore: number; lowScoreLines: number; repairedLines: number };
  // 对齐结果减原歌词时间的中位数：原歌词带时间时，管理员据此一眼看出投稿有没有片头 / 是不是另一个版本
  offsetSec: number;
  lrc: string;
  createdAt: number;
}

const PUNCT = /[\p{P}\p{S}\p{Z}_]/u;
const isLatin = (c: string) => /[A-Za-z0-9]/.test(c);

export function toWords(line: WorkerLine): AlignedLine["words"] {
  const words: AlignedLine["words"] = [];
  let k = 0;
  let prev = " ";
  for (const c of line.text) {
    if (!c.trim() || PUNCT.test(c)) {
      if (words.length) words[words.length - 1].text += c;
      else words.push({ text: c, start: line.t[0] ?? 0 });
      prev = c;
      continue;
    }
    const t = line.t[k++] ?? line.t[line.t.length - 1] ?? 0;
    // 拉丁字母只在词首开新段，否则 Hello 会变成 5 段
    if (isLatin(c) && isLatin(prev) && words.length) words[words.length - 1].text += c;
    else words.push({ text: c, start: t });
    prev = c;
  }
  return words;
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  return `${String(m).padStart(2, "0")}:${(t - m * 60).toFixed(2).padStart(5, "0")}`;
};

// 增强 LRC（行时间 + 每段 <mm:ss.xx>），给不认 JSON 的场景（导出、桌面歌词旧链路）用
export function toLrc(lines: AlignedLine[]): string {
  return (
    lines.map(l => `[${fmt(l.start)}]${l.words.map(w => `<${fmt(w.start)}>${w.text}`).join("")}`).join("\n") + "\n"
  );
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export const LOW_LINE_SCORE = 0.05;

// 歌词和音频不是同一首 / 同一版本时，强制对齐仍会「硬塞」出一个结果，必须拦下来，否则审核员和用户看到的是满屏乱跳。
// 阈值来自 15 首对得上（含现场版、MV、带英文）和 4 组故意配错的歌（调研 5.2.15）：
//   对得上：行置信度中位数 0.277 ~ 0.670，局部重对齐采纳 0 ~ 2 行
//   配错的：中位数 0.161 ~ 0.215，局部重对齐采纳 4 ~ 12 行
// 两个条件同时满足才判错，单看任一条都离对得上的歌太近。纯文本歌词没有原时间、不做局部重对齐，只能单看中位数，阈值放更低。
export function looksMismatched(a: Pick<Alignment, "quality">, timed: boolean): boolean {
  const { medianScore, repairedLines } = a.quality;
  return timed ? medianScore < 0.25 && repairedLines >= 3 : medianScore < 0.2;
}

export function buildAlignment(
  target: { bvid: string; cid: string; lyricsHash: string },
  page: VideoPage,
  input: LyricLine[],
  output: WorkerOutput,
): Alignment {
  const lines: AlignedLine[] = output.lines
    .filter(l => l.t.length)
    .map(l => ({
      start: l.t[0],
      text: l.text,
      words: toWords(l),
      score: l.score,
      ...(l.repaired ? { repaired: true as const } : {}),
    }));
  const scores = output.lines.filter(l => l.t.length).map(l => l.score);
  return {
    alignerVersion: ALIGNER_VERSION,
    ...target,
    video: { title: page.title, part: page.part, durationSec: page.durationSec },
    lines,
    quality: {
      medianScore: Number(median(scores).toFixed(4)),
      lowScoreLines: scores.filter(s => s < LOW_LINE_SCORE).length,
      repairedLines: lines.filter(l => l.repaired).length,
    },
    offsetSec: input.some(l => l.t) ? output.offset : 0,
    lrc: toLrc(lines),
    createdAt: Date.now(),
  };
}
