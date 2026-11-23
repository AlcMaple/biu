import { create } from "zustand";

import type { EmptyLyricsSelection } from "@/components/lyrics/cache";

export type LyricLine = {
  time: number; // milliseconds
  text: string;
  /** 逐字时间（毫秒），只有对齐过的歌词有 */
  words?: { text: string; time: number }[];
  /** words 来自歌词平台的原唱时间轴，不是按当前录音对齐出来的 */
  nativeWords?: true;
};

// 填词歌从视频画面识别歌词的进度：显示在歌词区，只对当前这首歌有效
export type ScreenStatus = { kind: "working" } | { kind: "failed"; message: string } | null;

type LyricsPreview = { lyrics: LyricLine[]; translatedLyrics: LyricLine[]; romanizedLyrics: LyricLine[] };

interface LyricsState {
  lyrics: LyricLine[];
  translatedLyrics: LyricLine[];
  // 罗马音只来自上传歌词随对齐结果带来的那一轨
  romanizedLyrics: LyricLine[];
  // 试听中的对齐结果：只用于显示（歌词面板 + 桌面歌词），不写缓存；采用才落盘，放弃或切歌就丢掉
  preview: LyricsPreview | null;
  offset: number;
  isLoading: boolean;
  emptySelection: EmptyLyricsSelection | null;
  screenStatus: ScreenStatus;
  screenOrigin: ScreenOrigin | null;
  setLyrics: (lyrics: LyricLine[], translatedLyrics?: LyricLine[], romanizedLyrics?: LyricLine[]) => void;
  setPreview: (preview: LyricsPreview | null) => void;
  setOffset: (offset: number) => void;
  setIsLoading: (loading: boolean) => void;
  setEmptySelection: (selection: EmptyLyricsSelection | null) => void;
  setScreenStatus: (status: ScreenStatus) => void;
  setScreenOrigin: (origin: ScreenOrigin | null) => void;
  reset: () => void;
}

const emptyLyrics = {
  lyrics: [],
  translatedLyrics: [],
  romanizedLyrics: [],
  preview: null,
  offset: 0,
  isLoading: false,
  emptySelection: null,
  screenStatus: null,
  screenOrigin: null,
};

export const useLyricsState = create<LyricsState>(set => ({
  ...emptyLyrics,
  setLyrics: (lyrics, translatedLyrics = [], romanizedLyrics = []) =>
    set({ lyrics, translatedLyrics, romanizedLyrics }),
  setPreview: preview => set({ preview }),
  setOffset: offset => set({ offset }),
  setIsLoading: loading => set({ isLoading: loading }),
  setEmptySelection: emptySelection => set(emptySelection ? { ...emptyLyrics, emptySelection } : { emptySelection }),
  setScreenStatus: screenStatus => set({ screenStatus }),
  setScreenOrigin: screenOrigin => set({ screenOrigin }),
  reset: () => set(emptyLyrics),
}));

// 试听时对齐结果自带准确时间，偏移归零；采用后缓存里的偏移也会归零
export const useDisplayedLyrics = () => {
  const lyrics = useLyricsState(s => s.preview?.lyrics ?? s.lyrics);
  const translatedLyrics = useLyricsState(s => s.preview?.translatedLyrics ?? s.translatedLyrics);
  const romanizedLyrics = useLyricsState(s => s.preview?.romanizedLyrics ?? s.romanizedLyrics);
  const offset = useLyricsState(s => (s.preview ? 0 : s.offset));
  return { lyrics, translatedLyrics, romanizedLyrics, offset };
};
