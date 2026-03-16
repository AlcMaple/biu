import { create } from "zustand";

export type LyricLine = {
  time: number; // milliseconds
  text: string;
};

interface LyricsState {
  lyrics: LyricLine[];
  translatedLyrics: LyricLine[];
  offset: number;
  isLoading: boolean;
  setLyrics: (lyrics: LyricLine[], translatedLyrics?: LyricLine[]) => void;
  setOffset: (offset: number) => void;
  setIsLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useLyricsState = create<LyricsState>(set => ({
  lyrics: [],
  translatedLyrics: [],
  offset: 0,
  isLoading: false,
  setLyrics: (lyrics, translatedLyrics = []) => set({ lyrics, translatedLyrics }),
  setOffset: offset => set({ offset }),
  setIsLoading: loading => set({ isLoading: loading }),
  reset: () => set({ lyrics: [], translatedLyrics: [], offset: 0, isLoading: false }),
}));
