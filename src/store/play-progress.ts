import { create } from "zustand";

interface ProgressState {
  currentTime: number;
  setCurrentTime: (time: number) => void;
  initCurrentTime: () => number;
  saveCurrentTime: () => void;
}

const PERSIST_INTERVAL_MS = 3000;
let lastPersistAt = 0;

export const usePlayProgress = create<ProgressState>((set, get) => ({
  currentTime: 0,
  initCurrentTime: () => {
    const localStorageTime = localStorage.getItem("play-current-time");
    if (localStorageTime) {
      const time = Number(localStorageTime);
      set({ currentTime: time });
      return time;
    }

    return 0;
  },
  saveCurrentTime: () => {
    if (get().currentTime) {
      localStorage.setItem("play-current-time", get().currentTime.toString());
    }
  },
  setCurrentTime: (time: number) => {
    set({ currentTime: time });
    // 切歌清零必须立刻落盘：否则快速切歌后刷新，会把上一首的进度套到新歌上
    if (time <= 0) {
      lastPersistAt = 0;
      try {
        localStorage.removeItem("play-current-time");
      } catch {
        // 存储不可用时忽略
      }
      return;
    }
    // 进程被杀时 beforeunload 不会触发，所以播放中也要定期落盘，下次打开才能接着上次的位置
    const now = Date.now();
    if (time > 0 && now - lastPersistAt >= PERSIST_INTERVAL_MS) {
      lastPersistAt = now;
      try {
        localStorage.setItem("play-current-time", time.toString());
      } catch {
        // 存储不可用时忽略
      }
    }
  },
}));
