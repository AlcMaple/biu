import { createHash } from "node:crypto";

import { AlignError } from "./errors.js";

export interface LyricLine {
  t: number;
  text: string;
}

const TIME_TAG = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
const WORD_TAG = /<\d+:\d+(?:[.:]\d+)?>/g;
const META_TAG = /^\[[a-z]+:.*\]$/i;
// 漏掉任何一行非演唱内容，强制对齐都会把它当成要唱的字塞进音频里，前后整段跟着错位。
// 以下几类都在真实歌词里出现过（网易云 / LrcLib），见调研 5.2.7、5.2.11：
const CREDIT_CN =
  /^(作词|作曲|编曲|制作人|制作|词|曲|监制|录音|混音|和声|和音|吉他|贝斯|鼓|弦乐|母带|出品|发行|统筹|策划|推广|OP|SP)\s*[:：]/i;
const CREDIT_EN =
  /\b(produced|producer|recorded|engineer(ed)?|mixed|mastered|mastering|arranged|conducted|coordination|vocals? recorded|programming|lyrics by|composed by|composer)\b/i;
// 「录音室 : The Garden」「混音师 : Joe」这类短前缀加冒号（冒号前可能有空格）
const SHORT_PREFIX_COLON = /^.{1,12}\s*[:：]/;
const ISRC = /^ISRC\b/i;
const TITLE_LINE = /^.+ - .+$/;

export const MAX_LINES = 300;
export const MAX_CHARS = 20_000;

const toSeconds = (m: string, s: string, f?: string) =>
  Number(m) * 60 + Number(s) + (f ? Number(f) / 10 ** f.length : 0);

// 支持 LRC（可带多个时间标签、网易云 JSON 制作人员行）和纯文本；返回清洗后的行，按时间排序。
// 纯文本没有时间时 t 全为 0，只影响「局部重对齐」能不能用，不影响整首对齐。
export function parseLyrics(raw: string): LyricLine[] {
  if (raw.length > MAX_CHARS * 4) throw new AlignError("LYRICS_TOO_LONG");
  const kept: (LyricLine & { colon: boolean })[] = [];
  let timed = false;
  for (const rawLine of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("{")) continue;
    if (META_TAG.test(line) && !/^\[\d/.test(line)) continue;
    const times = [...line.matchAll(TIME_TAG)].map(m => toSeconds(m[1], m[2], m[3]));
    const text = line.replace(TIME_TAG, "").replace(WORD_TAG, "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (CREDIT_CN.test(text) || CREDIT_EN.test(text) || ISRC.test(text)) continue;
    if (kept.length === 0 && TITLE_LINE.test(text) && (times.length === 0 || times[0] < 10)) continue;
    if (times.length) timed = true;
    for (const t of times.length ? times : [0]) kept.push({ t, text, colon: SHORT_PREFIX_COLON.test(text) });
  }
  if (timed) kept.sort((a, b) => a.t - b.t);
  // 「短前缀 + 冒号」只在开头 / 结尾成片出现时才是制作名单；夹在中间的是歌词本身（如「他说：我爱你」），不能删
  let head = 0;
  let tail = kept.length;
  while (head < tail && kept[head].colon) head++;
  while (tail > head && kept[tail - 1].colon) tail--;
  const out: LyricLine[] = kept.slice(head, tail).map(({ t, text }) => ({ t, text }));
  if (!out.length) throw new AlignError("LYRICS_EMPTY");
  if (out.length > MAX_LINES || out.reduce((n, l) => n + l.text.length, 0) > MAX_CHARS)
    throw new AlignError("LYRICS_TOO_LONG");
  return out;
}

// 缓存键的一部分：同一份歌词换个空格、换行风格不该重新对齐；时间参与哈希，因为它决定局部重对齐的窗口
export function lyricsHash(lines: LyricLine[]): string {
  const canonical = lines.map(l => `${l.t.toFixed(2)}\t${l.text}`).join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export const BVID_RE = /^BV[0-9A-Za-z]{10}$/;

export function parseTarget(bvid: unknown, cid: unknown): { bvid: string; cid: string } {
  const c = typeof cid === "number" ? String(cid) : cid;
  if (typeof bvid !== "string" || !BVID_RE.test(bvid) || typeof c !== "string" || !/^\d{1,15}$/.test(c)) {
    throw new AlignError("BAD_REQUEST", "bvid / cid 格式不对");
  }
  return { bvid, cid: c };
}
