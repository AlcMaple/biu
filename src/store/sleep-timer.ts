import { addToast } from "@heroui/react";
import { create } from "zustand";

export const SLEEP_TIMER_PRESETS = [10, 20, 30, 45, 60, 90];
export const SLEEP_TIMER_DEFAULT_MINUTES = 30;
export const SLEEP_TIMER_MAX_MINUTES = 999;

interface SleepTimerState {
  // 存截止时刻而不是剩余秒数：手机锁屏 / 切后台时计时器会被降频甚至冻结，
  // 每次检查都拿 Date.now() 比，醒来后能立刻判断出「已经过点」，不会越拖越晚。
  endAt: number | null;
  minutes: number | null;
  isCustom: boolean;
  waitSongEnd: boolean;
  // 时间已到、正在等这首播完
  pending: boolean;
}

interface SleepTimerAction {
  start: (minutes: number, isCustom?: boolean) => void;
  cancel: () => void;
  setWaitSongEnd: (value: boolean) => void;
}

interface SleepTimerBinding {
  audio: HTMLAudioElement;
  isSingleLoop: () => boolean;
}

let binding: SleepTimerBinding | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

// 不持久化：重启 / 刷新后沿用旧截止时刻，会出现刚打开就被停掉的情况
export const useSleepTimer = create<SleepTimerState & SleepTimerAction>()((set, get) => ({
  endAt: null,
  minutes: null,
  isCustom: false,
  waitSongEnd: true,
  pending: false,
  start: (minutes, isCustom = false) => {
    set({ endAt: Date.now() + minutes * 60_000, minutes, isCustom, pending: false });
    restoreLoop();
    ensureTicker();
    checkSleepTimer();
  },
  cancel: () => {
    set({ endAt: null, minutes: null, isCustom: false, pending: false });
    restoreLoop();
    stopTicker();
  },
  setWaitSongEnd: value => {
    set({ waitSongEnd: value });
    if (!value && get().pending) stopPlayback();
  },
}));

export const isSleepTimerActive = (s: Pick<SleepTimerState, "endAt" | "pending">) => s.endAt !== null || s.pending;

// 单曲循环靠 audio.loop 实现，循环时不会触发 ended；等本首播完期间临时关掉，停下后再按播放模式还原
function restoreLoop() {
  if (binding) binding.audio.loop = binding.isSingleLoop();
}

function ensureTicker() {
  if (ticker === null) ticker = setInterval(checkSleepTimer, 1000);
}

function stopTicker() {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

function stopPlayback() {
  useSleepTimer.setState({ endAt: null, minutes: null, isCustom: false, pending: false });
  stopTicker();
  if (binding && !binding.audio.paused) binding.audio.pause();
  restoreLoop();
  addToast({ title: "定时关闭已暂停播放" });
}

export function checkSleepTimer(now = Date.now()) {
  const { endAt, pending, waitSongEnd } = useSleepTimer.getState();
  if (pending) {
    // 等待期间用户可能切到单曲循环，播放模式切换会把 loop 重新打开
    if (binding?.audio.loop) binding.audio.loop = false;
    return;
  }
  if (endAt === null || now < endAt) return;

  const playing = binding ? !binding.audio.paused : false;
  if (waitSongEnd && playing) {
    useSleepTimer.setState({ endAt: null, pending: true });
    if (binding) binding.audio.loop = false;
    return;
  }
  stopPlayback();
}

// 在播放列表的 ended 处理里最先调用；返回 true 表示这次结束由定时关闭接管，不要切下一首
export function consumeSleepTimerOnEnded() {
  if (!useSleepTimer.getState().pending) return false;
  stopPlayback();
  return true;
}

export function bindSleepTimer(next: SleepTimerBinding) {
  if (binding?.audio === next.audio) {
    binding = next;
    return;
  }
  binding = next;
  // timeupdate 在页面切后台时往往比 setInterval 活得久，作为第二个检查点
  next.audio.addEventListener("timeupdate", () => checkSleepTimer());
  document.addEventListener("visibilitychange", () => checkSleepTimer());
}
