import type { VideoPage } from "./bilibili.js";
import type { LyricLine } from "./lyrics.js";

// 算法有实质改动（参数、门控、分块方式）时加一，旧缓存自动失效。
// 2：支持日语 / 韩语 / 英语。必须加一：「歌词对不上」会被记成粘滞失败，不加一，以前把日语歌误判成对不上的记录会一直命中
export const ALIGNER_VERSION = 2;

export type AlignLang = "zh" | "ja" | "ko" | "en";

export interface WorkerLine {
  text: string;
  chars: string[];
  t: number[];
  score: number;
  repaired?: boolean;
}

export interface WorkerOutput {
  lang: AlignLang;
  lines: WorkerLine[];
  offset: number;
  frameMs: number;
  // 修复前的行起点落在「原歌词时间 + 整首偏移」±1 s 内的比例；原歌词没有时间时为 null
  timelineMatch: number | null;
}

// 客户端按 words 逐段点亮：每段是一个汉字或一个拉丁词，标点和空格并进前一段，拼起来就是原文
export interface AlignedLine {
  start: number;
  text: string;
  words: { text: string; start: number }[];
  score: number;
  repaired?: true;
  /** 同一句的译文 / 罗马音，不参与对齐 */
  translation?: string;
  romanization?: string;
}

export interface Alignment {
  alignerVersion: number;
  bvid: string;
  cid: string;
  lyricsHash: string;
  video: Pick<VideoPage, "title" | "part" | "durationSec">;
  lines: AlignedLine[];
  quality: {
    lang: AlignLang;
    medianScore: number;
    lowScoreLines: number;
    repairedLines: number;
    timelineMatch: number | null;
  };
  // 对齐结果减原歌词时间的中位数：原歌词带时间时，管理员据此一眼看出投稿有没有片头 / 是不是另一个版本
  offsetSec: number;
  lrc: string;
  createdAt: number;
}

const PUNCT = /[\p{P}\p{S}\p{Z}_]/u;
const isLatin = (c: string) => /[A-Za-z0-9]/.test(c);

export function toWords(line: WorkerLine): AlignedLine["words"] {
  const words: AlignedLine["words"] = [];
  const text = [...line.text];
  let k = 0;
  let prev = " ";
  for (const [i, c] of text.entries()) {
    // 词中间的撇号（I've、don't）留在词里，否则 I've 会被拆成「I'」和「ve」两段分别点亮
    if (/['’]/.test(c) && isLatin(prev) && isLatin(text[i + 1] ?? "") && words.length) {
      words[words.length - 1].text += c;
      continue;
    }
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
// 中文：阈值来自 15 首对得上（含现场版、MV、带英文）和 4 组故意配错的歌（调研 5.2.15）：
//   对得上：行置信度中位数 0.277 ~ 0.670，局部重对齐采纳 0 ~ 2 行
//   配错的：中位数 0.161 ~ 0.215，局部重对齐采纳 4 ~ 12 行
//   两个条件同时满足才判错，单看任一条都离对得上的歌太近。纯文本歌词没有原时间、不做局部重对齐，只能单看中位数，阈值放更低。
// 外语不能用这条：英语声学置信度整体偏低，23 首对得上的外语歌里有 6 首会被误判。改看修复前行起点和原歌词时间的吻合度
// （多语言调研 4.5）：对得上的 80% ~ 100%，故意配错的 6% ~ 27%，取中间 50%。
// 外语纯文本歌词不判：置信度两边重叠（对得上最低 0.111，配错最高 0.242），只出现在用户上传，本来就要人工审核
export function looksMismatched(a: Pick<Alignment, "quality">, timed: boolean): boolean {
  const { lang, medianScore, repairedLines, timelineMatch } = a.quality;
  if (lang !== "zh") return timed && timelineMatch !== null && timelineMatch < 0.5;
  return timed ? medianScore < 0.25 && repairedLines >= 3 : medianScore < 0.2;
}

const TAG_LEAD_SEC = 0.3;
const round3 = (t: number) => Math.round(t * 1000) / 1000;

export function buildAlignment(
  target: { bvid: string; cid: string; lyricsHash: string },
  page: VideoPage,
  input: LyricLine[],
  output: WorkerOutput,
): Alignment {
  // 演唱者标记没送去对齐，接回行首：在第一个字唱出前的 TAG_LEAD_SEC 里逐字点亮完，不和第一个字挤在同一刻；
  // 往前借的时间不越过上一行最后一个字
  let prevLast = 0;
  const lines: AlignedLine[] = output.lines.flatMap((l, i) => {
    if (!l.t.length) return [];
    const tag = input[i]?.tag;
    const first = l.t[0];
    const lead = Math.max(0, Math.min(TAG_LEAD_SEC, first - prevLast));
    const tagChars = tag ? [...tag] : [];
    const tagWords = tagChars.map((c, k) => ({ text: c, start: round3(first - lead + (lead * k) / tagChars.length) }));
    prevLast = l.t[l.t.length - 1];
    return [
      {
        start: tagWords[0]?.start ?? first,
        text: tag ? tag + l.text : l.text,
        words: [...tagWords, ...toWords(l)],
        score: l.score,
        ...(input[i]?.translation ? { translation: input[i].translation } : {}),
        ...(input[i]?.romanization ? { romanization: input[i].romanization } : {}),
        ...(l.repaired ? { repaired: true as const } : {}),
      },
    ];
  });
  const scores = output.lines.filter(l => l.t.length).map(l => l.score);
  return {
    alignerVersion: ALIGNER_VERSION,
    // 逐个取字段，不能 ...target：调用方传的是整个任务对象，展开会把提交者 mid、任务 id 一起写进缓存，再经公开接口返回给所有人
    bvid: target.bvid,
    cid: target.cid,
    lyricsHash: target.lyricsHash,
    video: { title: page.title, part: page.part, durationSec: page.durationSec },
    lines,
    quality: {
      lang: output.lang,
      medianScore: Number(median(scores).toFixed(4)),
      lowScoreLines: scores.filter(s => s < LOW_LINE_SCORE).length,
      repairedLines: lines.filter(l => l.repaired).length,
      timelineMatch: output.timelineMatch,
    },
    offsetSec: input.some(l => l.t) ? output.offset : 0,
    lrc: toLrc(lines),
    createdAt: Date.now(),
  };
}
