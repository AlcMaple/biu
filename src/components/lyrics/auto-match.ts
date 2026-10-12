import platform from "@/platform";

import { parseLrc } from "./parse-lrc";
import { foldVariants } from "./variant-fold";

const NETEASE_TYPE_SONG = 1;
/** 视频时长与曲库时长允许的最大差距（秒）：翻唱/搬运常有前后奏差异，过严会漏，过松会配错歌 */
const MAX_DURATION_DIFF = 12;
const SEARCH_LIMIT = 15;
const MAX_CANDIDATES = 4;
const MAX_LYRICS_TRIES = 3;
/** 同一首歌的相邻两次外部请求之间的最小间隔（毫秒），避免触发上游限流 */
const REQUEST_GAP_MS = 700;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type IsCanceled = () => boolean;

/** 全局串行队列：快速切歌时，不同歌曲的自动匹配也排队执行，请求间隔始终 >= REQUEST_GAP_MS */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};
/** 歌名过短（如「谜」）时，同名歌极多，必须有歌手证据才敢采用 */
const SHORT_TITLE_LEN = 2;
/** 命中此分数以下视为足够可信，不再继续试下一个候选 */
const CONFIDENT_SCORE = -3;

export interface AutoLyricsResult {
  lyrics: string;
  tLyrics?: string;
  from: "netease" | "lrclib";
}

const BRACKET_PAIRS = /【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)|「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/g;
const BOOK_QUOTE = /《([^》]+)》/;
const CORNER_QUOTE = /[「『]([^」』]+)[」』]/;
const SEPARATORS = /\s*[-－—–]\s*|\s*\/\s*|\s+covered?\s+by\s+|\s*cover\s*[:：]?\s+|\s+feat\.?\s+/i;
/** 标题里的非歌名噪声词；遇到新的噪声往这里补 */
const NOISE_WORDS =
  /(翻唱|翻调|填词|中字|搬运|官方|原创|完整版|高音质|动态歌词|歌词版|歌词|字幕版|MV|PV|Official|Lyric\s*Video|Hi-?Res|无损|OP\d*|ED\d*)/gi;

const normalize = (s: string) => foldVariants(s.normalize("NFKC").toLowerCase()).replace(/[\s\p{P}\p{S}]/gu, "");

/**
 * 从视频标题生成「歌名候选」，按可信度排序，之后逐个搜索、统一打分，由曲库结果（歌名+歌手+时长）来裁决。
 * 不在这里赌一个答案：「」里可能是歌名（UNISON…「オリオンをなぞる」），也可能是歌词（韦礼安-如果可以「如果可以我想和你回到那天相遇」）。
 */
export const extractTitleCandidates = (rawTitle: string): string[] => {
  const out: string[] = [];
  const push = (s?: string) => {
    const t = s
      ?.replace(NOISE_WORDS, " ")
      .replace(/\s+YH\s*$/i, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (t && !out.includes(t)) out.push(t);
  };

  push(rawTitle.match(BOOK_QUOTE)?.[1]);

  const stripped = rawTitle
    .replace(/\s*covered?\s+by\s+.*$/i, " ")
    .replace(BRACKET_PAIRS, " ")
    .replace(/\s+\S{1,12}(?:翻唱|翻调)/g, " ")
    .replace(/《[^》]*》/g, " ");
  const parts = stripped
    .split(SEPARATORS)
    .map(p => p.replace(NOISE_WORDS, " ").trim())
    .filter(Boolean);
  const corner = rawTitle.match(CORNER_QUOTE)?.[1];

  if (parts.length > 1) {
    // 「歌手-歌名」与「歌名-歌手」都常见，两侧都当候选，让曲库结果裁决
    parts.slice().reverse().forEach(push);
    push(corner);
  } else {
    push(corner);
    push(parts[0]);
  }
  push(stripped);
  push(rawTitle.replace(BRACKET_PAIRS, " "));
  return out.slice(0, MAX_CANDIDATES);
};

/** 供手动搜索弹窗作默认关键词 */
export const extractSongInfo = (rawTitle: string) => ({
  title: extractTitleCandidates(rawTitle)[0] ?? rawTitle.trim(),
});

const titleMatches = (songName: string, title: string) => {
  const a = normalize(songName);
  const b = normalize(title);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 2 && long.includes(short) && short.length / long.length >= 0.35;
};

const hasArtistEvidence = (artistNames: string[], rawNorm: string) =>
  artistNames.some(n => {
    const na = normalize(n);
    return na.length >= 2 && rawNorm.includes(na);
  });

interface Scored {
  song: NeteaseSong;
  score: number;
}

const pickNetease = (songs: NeteaseSong[], title: string, rawNorm: string, duration?: number): Scored[] => {
  const shortTitle = normalize(title).length <= SHORT_TITLE_LEN;
  const scored: Scored[] = [];
  for (const song of songs) {
    if (!song.id || !song.name) continue;
    const names = [song.name, ...(song.alias ?? []), ...(song.transNames ?? [])];
    if (!names.some(n => titleMatches(n, title))) continue;
    const artistHit = hasArtistEvidence(
      (song.artists ?? []).map(a => a.name ?? ""),
      rawNorm,
    );
    if (shortTitle && !artistHit) continue;
    let score = 0;
    if (duration && song.duration) {
      const diff = Math.abs(song.duration / 1000 - duration);
      if (diff > MAX_DURATION_DIFF) continue;
      score += diff;
    }
    if (normalize(song.name) === normalize(title)) score -= 3;
    if (artistHit) score -= 6;
    scored.push({ song, score });
  }
  return scored;
};

const fromNetease = async (candidates: string[], rawNorm: string, isCanceled: IsCanceled, duration?: number) => {
  const pool = new Map<number, Scored>();
  for (const [i, title] of candidates.entries()) {
    if (i > 0) await sleep(REQUEST_GAP_MS);
    if (isCanceled()) return null;
    const res = await platform.searchNeteaseSongs({
      s: title,
      type: NETEASE_TYPE_SONG,
      limit: SEARCH_LIMIT,
      offset: 0,
    });
    for (const hit of pickNetease(res?.result?.songs ?? [], title, rawNorm, duration)) {
      const prev = pool.get(hit.song.id!);
      if (!prev || hit.score < prev.score) pool.set(hit.song.id!, hit);
    }
    if ([...pool.values()].some(h => h.score <= CONFIDENT_SCORE)) break;
  }
  // 最优的那首可能没有歌词（纯音乐/无词版本），依次尝试前几名
  const ranked = [...pool.values()].toSorted((x, y) => x.score - y.score).slice(0, MAX_LYRICS_TRIES);
  for (const { song } of ranked) {
    await sleep(REQUEST_GAP_MS);
    if (isCanceled()) return null;
    const lrc = await platform.getNeteaseLyrics({ id: song.id! });
    const text = lrc?.lrc?.lyric?.trim() || "";
    if (parseLrc(text).length < 3) continue;
    return { lyrics: text, tLyrics: lrc?.tlyric?.lyric?.trim() || undefined, from: "netease" as const };
  }
  return null;
};

const fromLrclib = async (candidates: string[], rawNorm: string, isCanceled: IsCanceled, duration?: number) => {
  // lrclib 的 duration 单位为秒；视频时长未知时不敢自动采用
  if (!duration) return null;
  for (const [i, title] of candidates.entries()) {
    if (i > 0) await sleep(REQUEST_GAP_MS);
    if (isCanceled()) return null;
    const list = (await platform.searchLrclibLyrics({ q: title })) ?? [];
    const shortTitle = normalize(title).length <= SHORT_TITLE_LEN;
    let best: { text: string; diff: number } | null = null;
    for (const x of list) {
      if (!x.syncedLyrics || !x.duration || !titleMatches(x.trackName || x.name || "", title)) continue;
      if (shortTitle && !hasArtistEvidence([x.artistName ?? ""], rawNorm)) continue;
      const diff = Math.abs(x.duration - duration);
      if (diff > MAX_DURATION_DIFF) continue;
      if (!best || diff < best.diff) best = { text: x.syncedLyrics, diff };
    }
    if (best) return { lyrics: best.text, from: "lrclib" as const };
  }
  return null;
};

/**
 * 按视频标题自动匹配歌词：生成多个歌名候选 → 在网易云搜索 → 用「歌名 + 歌手(是否出现在标题里) + 时长」统一打分选最优；失败再试 LrcLib。
 * 宁缺毋滥：歌名不符、时长差超过阈值、短歌名无歌手证据，一律不采用。
 */
export const autoMatchLyrics = (
  rawTitle: string,
  duration?: number,
  isCanceled: IsCanceled = () => false,
): Promise<AutoLyricsResult | null> =>
  enqueue(async () => {
    const candidates = extractTitleCandidates(rawTitle);
    if (!candidates.length || isCanceled()) return null;
    const rawNorm = normalize(rawTitle);
    try {
      const hit = await fromNetease(candidates, rawNorm, isCanceled, duration);
      if (hit) return hit;
    } catch {
      // 网易云失败则继续走 LrcLib
    }
    if (isCanceled()) return null;
    await sleep(REQUEST_GAP_MS);
    try {
      return await fromLrclib(candidates, rawNorm, isCanceled, duration);
    } catch {
      return null;
    }
  });
