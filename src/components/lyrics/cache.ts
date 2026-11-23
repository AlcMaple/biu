import platform from "@/platform";
import { StoreNameMap } from "@shared/store";

let pending: Promise<unknown> = Promise.resolve();

export type EmptyLyricsSelection = "instrumental" | "missing";

export const emptySelectionOf = (entry?: MusicLyrics): EmptyLyricsSelection | null =>
  entry?.instrumental ? "instrumental" : entry?.noLyrics ? "missing" : null;

export function updateLyricsEntry(key: string, update: (previous?: MusicLyrics) => MusicLyrics | undefined) {
  // 两端都按整个歌词缓存写入，避免晚到的匹配或对齐用旧快照盖掉用户刚做的选择。
  const write = pending.then(async () => {
    const entries = (await platform.getStore(StoreNameMap.LyricsCache)) ?? {};
    const next = update(entries[key]);
    if (next) await platform.setStore(StoreNameMap.LyricsCache, { ...entries, [key]: next });
    return next;
  });
  pending = write.catch(() => undefined);
  return write;
}
