import type { LyricsProvider } from "@shared/lyrics-format";
import type { ProviderLyricsCandidate } from "@shared/lyrics-providers";

import platform from "@/platform";

import { parseLrc } from "./parse-lrc";
import { buildProviderAdoption, PROVIDER_LABELS } from "./provider-lyrics";
import { foldVariants } from "./variant-fold";

// 改动提取或打分后升级，只重匹配自动缓存；手动采用的歌词保留。案例见 docs/lyrics/自动匹配歌词-错误案例.md。
// 4：标题像填词歌的不再按标题搜（会配上原曲歌词），改从视频画面识别；旧版本按原曲配错的共享结果随之作废
// 5：没有 AI 字幕的填词歌也从画面识别、双语画面带翻译；4 版因为没字幕记下的「查无歌词」要重新识别
export const AUTO_MATCH_VERSION = 5;

const NETEASE_TYPE_SONG = 1;
/** 视频时长与曲库时长允许的最大差距（秒）：翻唱/搬运常有前后奏差异，过严会漏，过松会配错歌 */
const MAX_DURATION_DIFF = 12;
const SEARCH_LIMIT = 15;
const MAX_CANDIDATES = 4;
const MAX_LYRICS_TRIES = 3;
/** 同一首歌的相邻两次外部请求之间的最小间隔（毫秒），避免触发上游限流 */
const REQUEST_GAP_MS = 700;
// QQ / 酷狗 / AMLL 只在网易云、LrcLib 都没命中时兜底，顺序即优先级：QQ、酷狗有时长可校验，AMLL 没有，放最后
const FALLBACK_PROVIDERS: readonly LyricsProvider[] = ["qq", "kugou", "amll"];
const PROVIDER_MAX_SEARCHES = 2;
const PROVIDER_MAX_LYRICS_TRIES = 2;
// 渠道的每分钟 30 次预算（Web BFF 上是所有用户共用）要留一半给用户手动搜索，自动匹配最多占这个数
const AUTO_PROVIDER_REQUESTS_PER_MINUTE = 12;
const PROVIDER_WINDOW_MS = 60_000;
const DEFAULT_PROVIDER_COOLDOWN_MS = 60_000;
// 没有曲库时长的候选（AMLL）靠歌词末行兜底：末行不该晚于视频结束，也不该只占视频的一小段
const MIN_LAST_LINE_RATIO = 0.5;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type IsCanceled = () => boolean;

/** 全局串行队列：快速切歌时，不同歌曲的自动匹配也排队执行，请求间隔始终 >= REQUEST_GAP_MS */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};
// 短歌名的同名歧义多，一字歌名仍只接受歌手证据。
const SHORT_TITLE_LEN = 2;
// 明确主题歌语境只能补足两字歌名的证据，时差要求比一般匹配更严（秒）。
const THEME_DURATION_DIFF = 2;
/** 命中此分数以下视为足够可信，不再继续试下一个候选 */
const CONFIDENT_SCORE = -3;

export interface AutoLyricsResult {
  lyrics: string;
  tLyrics?: string;
  from: "netease" | "lrclib" | LyricsProvider;
  origin?: LyricsOrigin;
  nativeTiming?: NativeLyricsTiming;
}

// 渠道冷却与自动预算只在渲染端记：真正的限流闸在各端的 provider client 里，这里是让自动匹配比手动搜索更早收手
const providerCooldownUntil = new Map<LyricsProvider, number>();
const providerSentAt = new Map<LyricsProvider, number[]>();

// 五个渠道都完整查过且都没有，才算「确实没有」：被取消、限流冷却、预算用完、任何一步出错都不算，
// 否则一次网络抖动就会被当成这首歌没歌词、让所有用户几天内都不再查
export interface AutoMatchOutcome {
  exhausted: boolean;
}

const providerAvailable = (provider: LyricsProvider) => {
  const now = Date.now();
  if ((providerCooldownUntil.get(provider) ?? 0) > now) return false;
  const recent = (providerSentAt.get(provider) ?? []).filter(t => t > now - PROVIDER_WINDOW_MS);
  providerSentAt.set(provider, recent);
  return recent.length < AUTO_PROVIDER_REQUESTS_PER_MINUTE;
};

const markProviderSent = (provider: LyricsProvider) => providerSentAt.get(provider)?.push(Date.now());

const BRACKET_PAIRS = /【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)|「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/g;
const BOOK_QUOTE = /《([^》]+)》/;
const CORNER_QUOTE = /[「『]([^」』]+)[」』]/;
// 无引号时只认大写标记，避免把 Ed Sheeran 或 In The End 当成主题歌说明。
const SONG_MARK =
  /(?:\b(?:OP|ED|OST)\d*(?![a-zA-Z])(?:\s*主题[曲歌])?|插曲|主题[曲歌]|片头[曲歌]|片尾[曲歌]|角色歌)\s*[:：]?\s*/;
const SONG_MARK_BEFORE_CORNER =
  /(?:\b(?:OP|ED|OST|IN)\d*(?![a-z])(?:\s*主题[曲歌])?|插曲|主题[曲歌]|片头[曲歌]|片尾[曲歌]|角色歌)\s*[:：]?\s*[「『]([^」』]+)[」』]/i;
const ARTIST_LIST = /[、,，&＆]/;
const SEPARATORS = /\s*[-－—–]\s*|\s*\/\s*|\s+covered?\s+by\s+|\s*cover\s*[:：]?\s+|\s+feat\.?\s+/i;
/** 标题里的非歌名噪声词；遇到新的噪声往这里补 */
const NOISE_WORDS =
  /(翻唱|翻调|填词|中字|搬运|官方|原创|完整版|高音质|动态歌词|歌词版|歌词|字幕版|MV|PV|Official|Lyric\s*Video|Hi-?Res|无损|OP\d*|ED\d*)/gi;

const normalize = (s: string) => foldVariants(s.normalize("NFKC").toLowerCase()).replace(/[\s\p{P}\p{S}]/gu, "");

const cleanTitle = (s: string) =>
  s
    .replace(NOISE_WORDS, " ")
    .replace(/\s+YH\s*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractThemeTitle = (rawTitle: string) => {
  const corner = rawTitle.match(SONG_MARK_BEFORE_CORNER)?.[1];
  if (corner) return cleanTitle(corner);
  const stripped = rawTitle.replace(BRACKET_PAIRS, " ").replace(/《[^》]*》/g, " ");
  const mark = SONG_MARK.exec(stripped);
  if (!mark) return "";
  return cleanTitle(stripped.slice(mark.index + mark[0].length).split(SEPARATORS)[0]);
};

// 「」可能是歌名，也可能是歌词摘句；保留多个候选，由曲库的歌名、歌手和时长裁决。
export const extractTitleCandidates = (rawTitle: string): string[] => {
  const out: string[] = [];
  const push = (s?: string) => {
    const t = s ? cleanTitle(s) : "";
    if (t && !out.includes(t)) out.push(t);
  };

  push(extractThemeTitle(rawTitle));
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
    // 含顿号/逗号的多半是歌手列表，排到最后
    const reversed = parts.slice().reverse();
    [...reversed.filter(p => !ARTIST_LIST.test(p)), ...reversed.filter(p => ARTIST_LIST.test(p))].forEach(push);
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

/** 视频标题是否含有该歌名（忽略大小写、标点、繁简） */
export const titleIncludesSong = (videoTitle: string, songName: string) => {
  const song = normalize(songName);
  return song.length > 0 && normalize(videoTitle).includes(song);
};

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

interface MatchTrack {
  name: string;
  artists: string[];
  duration?: number;
}

const closeThemeDuration = (trackDuration?: number, duration?: number) =>
  !!duration &&
  !!trackDuration &&
  duration > 0 &&
  trackDuration > 0 &&
  Math.abs(trackDuration - duration) <= THEME_DURATION_DIFF;

const hasUniqueThemeArtist = (tracks: MatchTrack[], themeTitle: string, duration?: number) => {
  if (themeTitle.length !== SHORT_TITLE_LEN) return false;
  const matching = tracks.filter(t => normalize(t.name) === themeTitle && closeThemeDuration(t.duration, duration));
  const artists = matching.map(t => t.artists.map(normalize).filter(Boolean).toSorted().join("/"));
  return artists.length > 0 && artists.every(Boolean) && new Set(artists).size === 1;
};

const pickNetease = (
  songs: NeteaseSong[],
  title: string,
  rawNorm: string,
  themeTitle: string,
  duration?: number,
): Scored[] => {
  const themeAllowed =
    normalize(title) === themeTitle &&
    hasUniqueThemeArtist(
      songs.map(song => ({
        name: song.name ?? "",
        artists: (song.artists ?? []).map(a => a.name ?? ""),
        duration: song.duration ? song.duration / 1000 : undefined,
      })),
      themeTitle,
      duration,
    );
  const scored: Scored[] = [];
  for (const song of songs) {
    if (!song.id || !song.name) continue;
    const names = [song.name, ...(song.alias ?? []), ...(song.transNames ?? [])];
    if (!names.some(n => titleMatches(n, title))) continue;
    const artistHit = hasArtistEvidence(
      (song.artists ?? []).map(a => a.name ?? ""),
      rawNorm,
    );
    const shortTitle =
      normalize(title).length <= SHORT_TITLE_LEN ||
      (themeTitle.length === SHORT_TITLE_LEN && normalize(song.name) === themeTitle);
    const themeHit =
      themeAllowed && normalize(song.name) === themeTitle && closeThemeDuration((song.duration ?? 0) / 1000, duration);
    if (shortTitle && !artistHit && !themeHit) continue;
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

const fromNetease = async (
  candidates: string[],
  rawNorm: string,
  themeTitle: string,
  isCanceled: IsCanceled,
  duration?: number,
) => {
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
    for (const hit of pickNetease(res?.result?.songs ?? [], title, rawNorm, themeTitle, duration)) {
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

const fromLrclib = async (
  candidates: string[],
  rawNorm: string,
  themeTitle: string,
  isCanceled: IsCanceled,
  duration?: number,
) => {
  // lrclib 的 duration 单位为秒；视频时长未知时不敢自动采用
  if (!duration) return null;
  for (const [i, title] of candidates.entries()) {
    if (i > 0) await sleep(REQUEST_GAP_MS);
    if (isCanceled()) return null;
    const list = (await platform.searchLrclibLyrics({ q: title })) ?? [];
    const themeAllowed =
      normalize(title) === themeTitle &&
      hasUniqueThemeArtist(
        list.map(x => ({ name: x.trackName || x.name || "", artists: [x.artistName ?? ""], duration: x.duration })),
        themeTitle,
        duration,
      );
    let best: { text: string; diff: number } | null = null;
    for (const x of list) {
      const name = x.trackName || x.name || "";
      if (!x.syncedLyrics || !x.duration || x.instrumental || !titleMatches(name, title)) continue;
      const shortTitle =
        normalize(title).length <= SHORT_TITLE_LEN ||
        (themeTitle.length === SHORT_TITLE_LEN && normalize(name) === themeTitle);
      const themeHit = themeAllowed && normalize(name) === themeTitle && closeThemeDuration(x.duration, duration);
      if (shortTitle && !hasArtistEvidence([x.artistName ?? ""], rawNorm) && !themeHit) continue;
      const diff = Math.abs(x.duration - duration);
      if (diff > MAX_DURATION_DIFF) continue;
      if (parseLrc(x.syncedLyrics).length < 3) continue;
      if (!best || diff < best.diff) best = { text: x.syncedLyrics, diff };
    }
    if (best) return { lyrics: best.text, from: "lrclib" as const };
  }
  return null;
};

interface ProviderFailure {
  kind: string;
  retryAfterMs?: number;
}

// 限流 / 服务异常之后这个渠道本轮不再碰；其他错误只放弃当前这次，不重试。都留一条日志，免得「没匹配到」看不出原因
const stopProvider = (provider: LyricsProvider, error: ProviderFailure) => {
  console.warn(`[auto-match] ${PROVIDER_LABELS[provider]}跳过：${error.kind}`);
  if (error.kind === "rate_limited" || error.kind === "upstream") {
    providerCooldownUntil.set(provider, Date.now() + (error.retryAfterMs ?? DEFAULT_PROVIDER_COOLDOWN_MS));
  }
};

const pickProvider = (
  list: ProviderLyricsCandidate[],
  title: string,
  rawNorm: string,
  themeTitle: string,
  duration: number,
) => {
  const themeAllowed =
    normalize(title) === themeTitle &&
    hasUniqueThemeArtist(
      list.map(c => ({
        name: c.title,
        artists: c.artists,
        duration: c.durationMs ? c.durationMs / 1000 : undefined,
      })),
      themeTitle,
      duration,
    );
  const scored: { candidate: ProviderLyricsCandidate; score: number }[] = [];
  for (const candidate of list) {
    if (!candidate.title || !titleMatches(candidate.title, title)) continue;
    const artistHit = hasArtistEvidence(candidate.artists, rawNorm);
    const trackDuration = candidate.durationMs ? candidate.durationMs / 1000 : undefined;
    const shortTitle =
      normalize(title).length <= SHORT_TITLE_LEN ||
      (themeTitle.length === SHORT_TITLE_LEN && normalize(candidate.title) === themeTitle);
    const themeHit =
      themeAllowed && normalize(candidate.title) === themeTitle && closeThemeDuration(trackDuration, duration);
    if (shortTitle && !artistHit && !themeHit) continue;
    let score = 0;
    if (trackDuration) {
      const diff = Math.abs(trackDuration - duration);
      if (diff > MAX_DURATION_DIFF) continue;
      score += diff;
    } else if (!artistHit) {
      // 没有时长可校验时，同名歌太多，只接受视频标题里出现了歌手的
      continue;
    }
    if (normalize(candidate.title) === normalize(title)) score -= 3;
    if (artistHit) score -= 6;
    scored.push({ candidate, score });
  }
  return scored;
};

const fromProvider = async (
  provider: LyricsProvider,
  candidates: string[],
  rawNorm: string,
  themeTitle: string,
  isCanceled: IsCanceled,
  duration: number,
): Promise<AutoLyricsResult | "incomplete" | null> => {
  const pool = new Map<string, { candidate: ProviderLyricsCandidate; score: number }>();
  for (const [i, title] of candidates.slice(0, PROVIDER_MAX_SEARCHES).entries()) {
    if (i > 0) await sleep(REQUEST_GAP_MS);
    if (isCanceled() || !providerAvailable(provider)) return "incomplete";
    markProviderSent(provider);
    const res = await platform.searchProviderLyrics({ provider, title });
    if (!res.ok) {
      stopProvider(provider, res.error);
      return "incomplete";
    }
    for (const hit of pickProvider(res.data, title, rawNorm, themeTitle, duration)) {
      const prev = pool.get(hit.candidate.id);
      if (!prev || hit.score < prev.score) pool.set(hit.candidate.id, hit);
    }
    if ([...pool.values()].some(h => h.score <= CONFIDENT_SCORE)) break;
  }
  const ranked = [...pool.values()].toSorted((x, y) => x.score - y.score).slice(0, PROVIDER_MAX_LYRICS_TRIES);
  for (const { candidate } of ranked) {
    await sleep(REQUEST_GAP_MS);
    if (isCanceled() || !providerAvailable(provider)) return "incomplete";
    // 酷狗取词是两次串行请求，按两次计预算
    markProviderSent(provider);
    if (provider === "kugou") markProviderSent(provider);
    const res = await platform.getProviderLyrics({
      provider,
      id: candidate.id,
      durationMs: candidate.durationMs,
      title: candidate.title,
      artist: candidate.artists.join("、"),
    });
    if (!res.ok) {
      if (res.error.kind === "not_found") continue;
      stopProvider(provider, res.error);
      return "incomplete";
    }
    const adoption = buildProviderAdoption(res.data, candidate);
    const lines = parseLrc(adoption.lyrics);
    if (lines.length < 3) continue;
    if (!candidate.durationMs) {
      const lastSec = lines[lines.length - 1].time / 1000;
      if (lastSec > duration + MAX_DURATION_DIFF || lastSec < duration * MIN_LAST_LINE_RATIO) continue;
    }
    return { ...adoption, from: provider };
  }
  return null;
};

// 短歌名通常需要歌手证据；明确主题歌的两字歌名，仅在精确同名、时差极小且无不同歌手歧义时补足证据。
export const autoMatchLyrics = (
  rawTitle: string,
  duration?: number,
  isCanceled: IsCanceled = () => false,
  outcome?: AutoMatchOutcome,
): Promise<AutoLyricsResult | null> =>
  enqueue(async () => {
    if (outcome) outcome.exhausted = false;
    // 视频时长未知时 LrcLib 与三个渠道都不敢采用，查不全
    let exhausted = Boolean(duration);
    const candidates = extractTitleCandidates(rawTitle);
    if (!candidates.length || isCanceled()) return null;
    const rawNorm = normalize(rawTitle);
    const themeTitle = normalize(extractThemeTitle(rawTitle));
    try {
      const hit = await fromNetease(candidates, rawNorm, themeTitle, isCanceled, duration);
      if (hit) return hit;
    } catch {
      // 网易云失败则继续走 LrcLib
      exhausted = false;
    }
    if (isCanceled()) return null;
    await sleep(REQUEST_GAP_MS);
    try {
      const hit = await fromLrclib(candidates, rawNorm, themeTitle, isCanceled, duration);
      if (hit) return hit;
    } catch {
      // LrcLib 失败则继续走 QQ / 酷狗 / AMLL
      exhausted = false;
    }
    // 视频时长未知时不敢自动采用，与 LrcLib 一致
    if (!duration) return null;
    for (const provider of FALLBACK_PROVIDERS) {
      if (isCanceled()) return null;
      if (!providerAvailable(provider)) {
        exhausted = false;
        continue;
      }
      await sleep(REQUEST_GAP_MS);
      try {
        const hit = await fromProvider(provider, candidates, rawNorm, themeTitle, isCanceled, duration);
        if (hit === "incomplete") exhausted = false;
        else if (hit) return hit;
      } catch (error) {
        console.warn(`[auto-match] ${PROVIDER_LABELS[provider]}异常`, error);
        exhausted = false;
      }
    }
    if (outcome) outcome.exhausted = exhausted && !isCanceled();
    return null;
  });
