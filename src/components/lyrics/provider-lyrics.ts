import type { LyricLine } from "@/store/lyrics-state";
import type { NormalizedLyrics } from "@shared/lyrics-format";
import type { ProviderLyricsCandidate, ProviderLyricsDocument, ProviderLyricsError } from "@shared/lyrics-providers";

import { parseLrc } from "@/components/lyrics/parse-lrc";
import { toLrc } from "@shared/lyrics-format";

export const PROVIDER_LABELS = { qq: "QQ 音乐", kugou: "酷狗", amll: "AMLL" } as const;

export interface ProviderAdoption {
  lyrics: string;
  tLyrics?: string;
  origin: LyricsOrigin;
  nativeTiming?: NativeLyricsTiming;
}

export function buildProviderAdoption(
  document: ProviderLyricsDocument,
  candidate: ProviderLyricsCandidate,
  now = Date.now(),
): ProviderAdoption {
  const { lyrics } = document;
  const lrc = toLrc(lyrics);
  const tLrc = toLrc(lyrics, "translation");
  return {
    lyrics: lrc,
    tLyrics: tLrc || undefined,
    origin: {
      provider: document.provider,
      sourceId: document.sourceId,
      title: candidate.title,
      artists: candidate.artists,
      author: document.author ?? candidate.author,
      format: lyrics.format,
      timing: lyrics.timing,
      adoptedAt: now,
    },
    nativeTiming: lyrics.timing === "word" ? nativeTimingOf(lyrics, lrc) : undefined,
  };
}

function nativeTimingOf(lyrics: NormalizedLyrics, lrc: string): NativeLyricsTiming {
  return {
    lyrics: lrc,
    lines: lyrics.lines.map(line => ({
      startMs: line.startMs,
      endMs: line.endMs,
      words: (line.words ?? []).map(word => ({ startMs: word.startMs, endMs: word.endMs, text: word.text })),
    })),
  };
}

// 平台逐字时间只在 lyrics 还是采用时那份时才用；之后自动匹配 / 对齐 / 还原改过 lyrics 就退回行级
export function nativeLinesOf(
  entry: Pick<MusicLyrics, "lyrics" | "nativeTiming"> | undefined,
): LyricLine[] | undefined {
  const timing = entry?.nativeTiming;
  if (!timing || !entry.lyrics || timing.lyrics !== entry.lyrics) return undefined;
  const lines = parseLrc(entry.lyrics);
  if (lines.length !== timing.lines.length) return undefined;
  return lines.map((line, index) => {
    const words = timing.lines[index].words;
    return words.length
      ? { ...line, words: words.map(word => ({ text: word.text, time: word.startMs })), nativeWords: true as const }
      : line;
  });
}

export function linesOfEntry(entry: Pick<MusicLyrics, "lyrics" | "nativeTiming"> | undefined): LyricLine[] {
  return nativeLinesOf(entry) ?? parseLrc(entry?.lyrics);
}

// 每类错误给能让用户判断「该不该再点」的话：限流 / 服务异常明说别连点，未收录建议换来源
const waitText = (ms: number) => (ms >= 60_000 ? `约 ${Math.ceil(ms / 60_000)} 分钟` : `约 ${Math.ceil(ms / 1000)} 秒`);

export function describeProviderError(error: ProviderLyricsError): string {
  const wait = error.retryAfterMs ? waitText(error.retryAfterMs) : undefined;
  switch (error.kind) {
    case "rate_limited":
      return `${error.message}，${wait ? `${wait}后` : "过几分钟"}再试；期间可以先用其他来源。连续重试会延长限制`;
    case "upstream":
      return `${error.message}，${wait ? `${wait}后` : "稍后"}再试，或换个来源`;
    case "timeout":
    case "network":
      return `${error.message}，可以换个来源或稍后再试`;
    case "not_found":
      return `${error.message}，可以换个来源试试`;
    default:
      return error.message;
  }
}
