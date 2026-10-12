import { audio } from "@/store/play-list";

import { reportWebLog } from "./web-log-transport";

/**
 * 网页端「后台被杀 / 被冻结」诊断（仅记录，不改变任何播放行为）。
 *
 * 进程被系统杀掉时页面没有任何机会发日志，所以换个思路：把生命周期轨迹落在 localStorage，
 * 下次冷启动时发现「上次没走完正常退出流程」，再把轨迹补报给服务端日志。
 * - 上次最后一个事件是 hidden 且当时在播放 => 后台播放中进程消失（被杀 / 被用户划掉，需结合 hiddenForMs 判断）
 * - 后台里音频被暂停（不是用户点的）=> 实时上报一条
 */

const STORAGE_KEY = "biu:lifecycle";
const HEARTBEAT_MS = 15_000;
const MAX_TRAIL = 24;

interface Snapshot {
  hiddenAt?: number;
  lastAt: number;
  lastEvent: string;
  playing: boolean;
  trail: string[];
}

let installed = false;
let snapshot: Snapshot = { lastAt: Date.now(), lastEvent: "start", playing: false, trail: [] };

const readPrevious = (): Snapshot | undefined => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Snapshot) : undefined;
  } catch {
    return undefined;
  }
};

const persist = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // 隐私模式 / 存储满：诊断丢了就丢了
  }
};

const record = (event: string) => {
  const now = Date.now();
  const playing = !audio.paused;
  if (event === "hidden") snapshot.hiddenAt = now;
  if (event === "visible") snapshot.hiddenAt = undefined;
  snapshot = {
    ...snapshot,
    lastAt: now,
    lastEvent: event,
    playing,
    trail: [...snapshot.trail, `${new Date(now).toISOString().slice(11, 19)} ${event}${playing ? "*" : ""}`].slice(
      -MAX_TRAIL,
    ),
  };
  persist();
};

const reportPreviousSession = (previous: Snapshot | undefined) => {
  if (!previous || previous.lastEvent === "pagehide") return;
  // 只关心「后台里正在播放 / 刚被冻结」的消失：前台关页签属于正常使用
  if (previous.lastEvent !== "hidden" && previous.lastEvent !== "freeze" && !previous.hiddenAt) return;
  reportWebLog("warn", [
    "上次会话在后台中断（疑似被系统杀掉或冻结）",
    {
      hiddenForMs: previous.hiddenAt ? previous.lastAt - previous.hiddenAt : undefined,
      lastEvent: previous.lastEvent,
      sinceLastEventMs: Date.now() - previous.lastAt,
      trail: previous.trail.join(" | "),
      wasPlaying: previous.playing,
    },
  ]);
};

export function installWebLifecycleDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  reportPreviousSession(readPrevious());
  snapshot = { lastAt: Date.now(), lastEvent: "start", playing: false, trail: [] };
  persist();

  document.addEventListener("visibilitychange", () => record(document.hidden ? "hidden" : "visible"));
  window.addEventListener("pagehide", () => record("pagehide"));
  window.addEventListener("pageshow", () => record("pageshow"));
  document.addEventListener("freeze", () => record("freeze"));
  document.addEventListener("resume", () => record("resume"));

  for (const type of ["play", "ended", "error", "stalled"] as const) {
    audio.addEventListener(type, () => record(`audio:${type}`));
  }
  audio.addEventListener("pause", () => {
    record("audio:pause");
    // 页面在后台时音频被暂停：可能是用户点了通知栏，也可能是系统强制暂停，一并上报由人判断
    if (document.hidden && snapshot.hiddenAt) {
      reportWebLog("info", [
        "后台中音频被暂停",
        { hiddenForMs: Date.now() - snapshot.hiddenAt, trail: snapshot.trail.join(" | ") },
      ]);
    }
  });

  // 心跳：给「进程消失」估一个时间下界。后台里定时器会被降频，只在可见或播放时写
  setInterval(() => {
    if (document.hidden && audio.paused) return;
    snapshot = { ...snapshot, lastAt: Date.now(), playing: !audio.paused };
    persist();
  }, HEARTBEAT_MS);
}
