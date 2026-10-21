import { create } from "zustand";

export type LyricLine = {
  time: number; // milliseconds
  text: string;
  /** 逐字时间（毫秒），只有对齐过的歌词有 */
  words?: { text: string; time: number }[];
  /** words 来自歌词平台的原唱时间轴，不是按当前录音对齐出来的 */
  nativeWords?: true;
};

type LyricsPreview = { lyrics: LyricLine[]; translatedLyrics: LyricLine[] };

interface LyricsState {
  lyrics: LyricLine[];
  translatedLyrics: LyricLine[];
  // 试听中的对齐结果：只用于显示（歌词面板 + 桌面歌词），不写缓存；采用才落盘，放弃或切歌就丢掉
  preview: LyricsPreview | null;
  offset: number;
  isLoading: boolean;
  setLyrics: (lyrics: LyricLine[], translatedLyrics?: LyricLine[]) => void;
  setPreview: (preview: LyricsPreview | null) => void;
  setOffset: (offset: number) => void;
  setIsLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useLyricsState = create<LyricsState>(set => ({
  lyrics: [],
  translatedLyrics: [],
  preview: null,
  offset: 0,
  isLoading: false,
  setLyrics: (lyrics, translatedLyrics = []) => set({ lyrics, translatedLyrics }),
  setPreview: preview => set({ preview }),
  setOffset: offset => set({ offset }),
  setIsLoading: loading => set({ isLoading: loading }),
  reset: () => set({ lyrics: [], translatedLyrics: [], preview: null, offset: 0, isLoading: false }),
}));

// 试听时对齐结果自带准确时间，偏移归零；采用后缓存里的偏移也会归零
export const useDisplayedLyrics = () => {
  const lyrics = useLyricsState(s => s.preview?.lyrics ?? s.lyrics);
  const translatedLyrics = useLyricsState(s => s.preview?.translatedLyrics ?? s.translatedLyrics);
  const offset = useLyricsState(s => (s.preview ? 0 : s.offset));
  return { lyrics, translatedLyrics, offset };
};
