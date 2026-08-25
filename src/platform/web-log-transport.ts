import {
  WEB_CLIENT_LOG_MAX_ENTRIES,
  WEB_CLIENT_LOG_MAX_MESSAGE,
  WEB_CLIENT_LOG_PATH,
  redactWebClientLogText,
  type WebClientLogEntry,
  type WebClientLogLevel,
} from "@shared/web-client-log";

/**
 * 把网页端的 warn/error 批量回传给同源服务落盘。
 *
 * - 只回传 warn/error（info/debug 留在 console），防止日志洪水；
 * - 攒批 + 定时 flush，页面隐藏时用 sendBeacon 兜底，避免每条日志一个请求；
 * - 发送失败就丢弃，不影响播放。
 */

const FLUSH_INTERVAL_MS = 5000;
/** 每分钟最多回传多少条：超出的直接丢，防止 renderer 侧的循环刷爆接口 */
const MAX_ENTRIES_PER_MINUTE = 60;
const RATE_WINDOW_MS = 60 * 1000;

let queue: WebClientLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let recentSendTimes: number[] = [];
let installed = false;

const sessionId = (() => {
  const random = () => Math.random().toString(36).slice(2, 12);
  try {
    const existing = sessionStorage.getItem("biu:log-session");
    if (existing) return existing;
    const created = `${random()}${random()}`;
    sessionStorage.setItem("biu:log-session", created);
    return created;
  } catch {
    return `${random()}${random()}`; // 隐私模式下 sessionStorage 可能不可用
  }
})();

/** console 风格结构化 context */
function formatArgs(args: unknown[]): { context?: Record<string, unknown>; message: string } {
  const parts: string[] = [];
  let context: Record<string, unknown> | undefined;

  for (const arg of args) {
    if (typeof arg === "string") {
      parts.push(arg);
      continue;
    }
    if (arg instanceof Error) {
      parts.push(`${arg.name}: ${arg.message}`);
      context = { ...context, stack: arg.stack };
      continue;
    }
    if (arg && typeof arg === "object" && !Array.isArray(arg)) {
      // 首个普通对象当作结构化上下文，其余并进去
      context = { ...context, ...(arg as Record<string, unknown>) };
      continue;
    }
    try {
      parts.push(JSON.stringify(arg));
    } catch {
      parts.push(String(arg));
    }
  }

  return { context, message: parts.join(" ") || "(empty log message)" };
}

function send(entries: WebClientLogEntry[], useBeacon: boolean) {
  const body = JSON.stringify({ entries, sessionId });
  try {
    if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // 页面正在离开：只有 sendBeacon 能保证请求发得出去
      navigator.sendBeacon(WEB_CLIENT_LOG_PATH, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(WEB_CLIENT_LOG_PATH, {
      body,
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  } catch {
    // 日志发不出去就算了，绝不冒泡影响播放
  }
}

function flush(useBeacon = false) {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (queue.length === 0) return;

  const entries = queue.slice(0, WEB_CLIENT_LOG_MAX_ENTRIES);
  queue = queue.slice(entries.length);
  send(entries, useBeacon);
  if (queue.length > 0) scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => flush(), FLUSH_INTERVAL_MS);
}

/** 客户端侧限流：坏掉的重试循环不该把日志接口一起拖下水 */
function withinRateLimit() {
  const now = Date.now();
  recentSendTimes = recentSendTimes.filter(time => now - time < RATE_WINDOW_MS);
  if (recentSendTimes.length >= MAX_ENTRIES_PER_MINUTE) return false;
  recentSendTimes.push(now);
  return true;
}

export function reportWebLog(level: WebClientLogLevel, args: unknown[]) {
  if (typeof window === "undefined") return;
  if (!withinRateLimit()) return;

  const { context, message } = formatArgs(args);
  queue.push({
    at: Date.now(),
    context,
    level,
    message: redactWebClientLogText(message).slice(0, WEB_CLIENT_LOG_MAX_MESSAGE),
  });

  // 攒够一批立刻发，否则等定时器
  if (queue.length >= WEB_CLIENT_LOG_MAX_ENTRIES) flush();
  else scheduleFlush();
}

/** 页面隐藏/卸载时把残留日志送出去；未捕获异常也一并上报 */
export function installWebLogTransport() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("pagehide", () => flush(true));
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("error", event => {
    reportWebLog("error", [`未捕获异常: ${event.message}`, { source: event.filename, line: event.lineno }]);
  });
  window.addEventListener("unhandledrejection", event => {
    reportWebLog("error", ["未处理的 Promise 拒绝", { reason: String((event as PromiseRejectionEvent).reason) }]);
  });
}
