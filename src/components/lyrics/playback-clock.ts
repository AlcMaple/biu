import { useEffect, useState } from "react";

import type { LyricLine } from "@/store/lyrics-state";

import { audio } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";

// 进度事件（timeupdate）每 250 ms 左右才来一次，按它切行会有 0~250 ms 的随机迟切；对齐再准用户看到的也是时快时慢。
// 播放中按帧直接读 audio.currentTime。暂停、跳转中仍用进度 store：跳转重新取流时进度条停在目标位置，audio 还在旧位置
export const readPlaybackMs = () =>
  (!audio.paused && !audio.seeking && audio.currentTime > 0
    ? audio.currentTime
    : usePlayProgress.getState().currentTime) * 1000;

export const findActiveIndex = (lyrics: LyricLine[], ms: number) => {
  if (!lyrics.length) return -1;
  for (let i = lyrics.length - 1; i >= 0; i -= 1) {
    if (ms >= lyrics[i].time) return i;
  }
  return 0;
};

// requestAnimationFrame 负责前台逐帧；窗口最小化 / 隐藏时 rAF 会停，再订阅进度 store 兜底，
// 否则主窗口缩到托盘后桌面歌词就不切行了
export function subscribePlaybackClock(onTick: (ms: number) => void) {
  let raf = 0;
  const loop = () => {
    onTick(readPlaybackMs());
    raf = requestAnimationFrame(loop);
  };
  loop();
  const unsubscribe = usePlayProgress.subscribe(() => onTick(readPlaybackMs()));
  return () => {
    cancelAnimationFrame(raf);
    unsubscribe();
  };
}

export function useActiveLyricIndex(lyrics: LyricLine[], offset: number) {
  const [index, setIndex] = useState(() => findActiveIndex(lyrics, readPlaybackMs() + offset));
  useEffect(() => subscribePlaybackClock(ms => setIndex(findActiveIndex(lyrics, ms + offset))), [lyrics, offset]);
  return index;
}
