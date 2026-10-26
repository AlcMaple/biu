import { createHash } from "node:crypto";

import { AlignError } from "./errors.js";

export interface LyricLine {
  t: number;
  text: string;
  // 行首的演唱者标记（「合：」「薇：」），原样显示，但不送去对齐：没人唱它，塞进音频会把整行往后挤
  tag?: string;
}

const TIME_TAG = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
const WORD_TAG = /<\d+:\d+(?:[.:]\d+)?>/g;
const META_TAG = /^\[[a-z]+:.*\]$/i;
// 漏掉任何一行非演唱内容，强制对齐都会把它当成要唱的字塞进音频里，前后整段跟着错位。
// 以下几类都在真实歌词里出现过（网易云 / LrcLib），见调研 5.2.7、5.2.11：
// 日文、韩文的作词 / 作曲 / 编曲和英文 Lyrics / Written 也在这里：多语言调研时网易云外语歌里出现过（多语言调研 4.3）
const CREDIT_CN =
  /^(作词|作曲|编曲|制作人|制作|词|曲|监制|录音|混音|和声|和音|吉他|贝斯|鼓|弦乐|母带|出品|发行|统筹|策划|推广|OP|SP|作詞|編曲|作詞・作曲|작사|작곡|편곡|Lyrics|Written)\s*[:：]/i;
const CREDIT_EN =
  /\b(produced|producer|recorded|engineer(ed)?|mixed|mastered|mastering|arranged|conducted|coordination|vocals? recorded|programming|lyrics by|composed by|composer)\b/i;
// 「录音室 : The Garden」「混音师 : Joe」这类短前缀加冒号（冒号前可能有空格）
const SHORT_PREFIX_COLON = /^.{1,12}\s*[:：]/;
const ISRC = /^ISRC\b/i;
// 整行被括号包住的演唱者标注（STAY 的「(The Kid LAROI)」）：不删的话会被当成要唱的词去占一段音频，前后几行跟着错位，
// 这首的行起点中位误差从 94 ms 涨到 239 ms（多语言调研 4.3）。方括号整行（[Chorus]、[Verse 1: X]）一律不唱；
// 圆括号里每个词都首字母大写、又不全是拟声词才算人名。(Oh, ooh-woah)、(Ohhhhh Ohhh Ohhh) 这类伴唱是真唱的，要留着
const BRACKET_LINE = /^[[【].*[\]】]$/;
const PAREN_LINE = /^[(（](.*)[)）]$/;
const NAME_JOINER = new Set(["&", "x", "×", "feat", "feat.", "ft.", "and", "/"]);
const VOCABLE = /^(o+h*|a+h*|y?e+a*h*|u+h*|w?o+a*h*|la|na|ha|hey|ooh+|mm+|uh+|whoa)$/i;

export function isSingerTag(text: string): boolean {
  if (BRACKET_LINE.test(text)) return true;
  const m = PAREN_LINE.exec(text);
  if (!m) return false;
  const words = m[1].split(/[\s,，]+/).filter(Boolean);
  if (!words.length) return true;
  const names = words.filter(w => !NAME_JOINER.has(w.toLowerCase()));
  // 首字母不是 ASCII 的（中日韩名字）按人名算
  if (!names.every(w => /^[^\p{ASCII}]/u.test(w) || /^[A-Z]/.test(w))) return false;
  return !names.every(w => VOCABLE.test(w.replace(/[^\p{L}\p{N}]/gu, "") || "x"));
}
const TITLE_LINE = /^.+ - .+$/;
const SINGER_PREFIX = /^([^\s:：]{1,4})\s*[:：]\s*(?=\S)/;

// 同一个前缀带着 3 句以上不同的歌词才算演唱者标记；只出现一两次的「他说：我爱你」是歌词本身
function singerTags(lines: { text: string }[]): Set<string> {
  const bodies = new Map<string, Set<string>>();
  for (const { text } of lines) {
    const m = SINGER_PREFIX.exec(text);
    if (!m) continue;
    const set = bodies.get(m[1]) ?? new Set<string>();
    set.add(text.slice(m[0].length));
    bodies.set(m[1], set);
  }
  return new Set([...bodies].filter(([, set]) => set.size >= 3).map(([name]) => name));
}

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
    if (CREDIT_CN.test(text) || CREDIT_EN.test(text) || ISRC.test(text) || isSingerTag(text)) continue;
    if (kept.length === 0 && TITLE_LINE.test(text) && (times.length === 0 || times[0] < 10)) continue;
    if (times.length) timed = true;
    for (const t of times.length ? times : [0]) kept.push({ t, text, colon: SHORT_PREFIX_COLON.test(text) });
  }
  if (timed) kept.sort((a, b) => a.t - b.t);
  const tags = singerTags(kept);
  for (const line of kept) {
    const m = SINGER_PREFIX.exec(line.text);
    if (!m || !tags.has(m[1])) continue;
    line.tag = m[0];
    // 合唱歌开头就是「藤：」「薇：」，不是制作名单
    line.colon = false;
  }
  // 「短前缀 + 冒号」只在开头 / 结尾成片出现时才是制作名单；夹在中间的是歌词本身（如「他说：我爱你」），不能删
  let head = 0;
  let tail = kept.length;
  while (head < tail && kept[head].colon) head++;
  while (tail > head && kept[tail - 1].colon) tail--;
  const out: LyricLine[] = kept.slice(head, tail).map(({ t, text, tag }) => (tag ? { t, text, tag } : { t, text }));
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
