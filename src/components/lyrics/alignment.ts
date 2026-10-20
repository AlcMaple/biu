import type { LyricLine } from "@/store/lyrics-state";

import { parseLrc } from "@/components/lyrics/parse-lrc";
import platform from "@/platform";
import { StoreNameMap } from "@shared/store";

type PlayItemLike = { source?: string; id?: string; bvid?: string; cid?: string | number } | undefined | null;

export const lyricsCacheKey = (item: PlayItemLike) =>
  item?.source === "local"
    ? item.id
      ? `local-${item.id}`
      : null
    : item?.bvid && item?.cid
      ? `${item.bvid}-${item.cid}`
      : null;

const sec = (ms: number) => ms / 1000;

export const alignmentToLines = (lines: AlignedLyricLine[]): LyricLine[] =>
  lines.map(l => ({
    time: Math.round(l.start * 1000),
    text: l.text,
    words: l.words.map(w => ({ text: w.text, time: Math.round(w.start * 1000) })),
  }));

const fmt = (ms: number) => {
  const m = Math.floor(ms / 60000);
  return `${String(m).padStart(2, "0")}:${(sec(ms) - m * 60).toFixed(2).padStart(5, "0")}`;
};

// 行级 LRC：桌面歌词、导出等只认行时间的地方仍读 lyrics 字段
const toLineLrc = (lines: LyricLine[]) => lines.map(l => `[${fmt(l.time)}]${l.text}`).join("\n");

const normalize = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();

// 翻译按原歌词的行时间挂靠；对齐后行时间变了，按文字顺序把每行翻译搬到对齐后的时间上
const retimeTranslation = (original: LyricLine[], translated: LyricLine[], aligned: LyricLine[]): LyricLine[] => {
  if (!translated.length) return [];
  const byTime = new Map(translated.map(t => [t.time, t.text]));
  const result: LyricLine[] = [];
  let cursor = 0;
  for (const line of aligned) {
    const key = normalize(line.text);
    for (let i = cursor; i < original.length; i += 1) {
      if (normalize(original[i].text) !== key) continue;
      const text = byTime.get(original[i].time);
      if (text) result.push({ time: line.time, text });
      cursor = i + 1;
      break;
    }
  }
  return result;
};

// 试听用：不读写缓存，翻译按当前在显示的原歌词搬到对齐后的时间上
export const previewAlignment = (alignment: LyricsAlignment, original: LyricLine[], translated: LyricLine[]) => {
  const lines = alignmentToLines(alignment.lines);
  return { lyrics: lines, translatedLyrics: retimeTranslation(original, translated, lines) };
};

export type AlignedSource = "aligned" | "approved";

export const isUserChosen = (entry: MusicLyrics | undefined) =>
  Boolean(
    entry && (entry.lyrics || entry.tLyrics) && (entry.source ?? "manual") !== "auto" && entry.source !== "approved",
  );

// 采用对齐结果：写进歌词缓存（Electron 的 electron-store / Android 的 Preferences / Web 的 IndexedDB 都走 platform.setStore）。
// 第一次采用时把原来的歌词留进 preAlign，之后可以还原；连续采用不覆盖它，否则还原只能回到上一次对齐结果。
// 偏移一并归零：手动调的偏移是在补原歌词的时间误差，对齐后的时间已经准了，留着反而错位；原值存进 preAlign，还原时带回来
export async function adoptAlignment(key: string, alignment: LyricsAlignment, source: AlignedSource) {
  const store = (await platform.getStore(StoreNameMap.LyricsCache)) ?? {};
  const prev = store[key] ?? {};
  const preAlign =
    prev.preAlign ??
    (prev.lyrics || prev.tLyrics
      ? {
          lyrics: prev.lyrics,
          tLyrics: prev.tLyrics,
          source: prev.source,
          autoVersion: prev.autoVersion,
          offset: prev.offset,
        }
      : undefined);
  const base = preAlign ?? prev;
  const lines = alignmentToLines(alignment.lines);
  const tLines = retimeTranslation(parseLrc(base.lyrics), parseLrc(base.tLyrics), lines);
  const next: MusicLyrics = {
    ...prev,
    lyrics: toLineLrc(lines),
    tLyrics: tLines.length ? toLineLrc(tLines) : undefined,
    source,
    autoVersion: undefined,
    alignment: { lyricsHash: alignment.lyricsHash, lines: alignment.lines },
    preAlign,
    offset: 0,
  };
  await platform.setStore(StoreNameMap.LyricsCache, { ...store, [key]: next });
  return { lines, tLines, hasPreAlign: Boolean(preAlign) };
}

export async function restorePreAlign(key: string) {
  const store = (await platform.getStore(StoreNameMap.LyricsCache)) ?? {};
  const prev = store[key];
  if (!prev?.alignment || !prev.preAlign) return undefined;
  // 还原后标成手动选择：否则打开时会再被审核通过的版本覆盖，用户点了还原等于没点
  const next: MusicLyrics = {
    ...prev,
    alignment: undefined,
    preAlign: undefined,
    lyrics: prev.preAlign?.lyrics,
    tLyrics: prev.preAlign?.tLyrics,
    source: "manual",
    autoVersion: undefined,
    offset: prev.preAlign?.offset ?? 0,
  };
  await platform.setStore(StoreNameMap.LyricsCache, { ...store, [key]: next });
  return { lines: parseLrc(next.lyrics), tLines: parseLrc(next.tLyrics), offset: next.offset ?? 0 };
}
