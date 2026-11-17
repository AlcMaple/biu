import { WATCH_RETRY_DELAYS_MS } from "./config";

export function watchRetryDelay(
  failures: number,
  serverAskedMs: number | undefined,
  blockedMs: number,
  random: () => number = Math.random,
): number {
  const backoff = WATCH_RETRY_DELAYS_MS[Math.min(failures, WATCH_RETRY_DELAYS_MS.length - 1)];
  // 抖动：服务恢复的那一刻，所有断线的客户端不该在同一秒一起涌回来
  const jittered = backoff * (0.8 + random() * 0.4);
  return Math.round(Math.max(jittered, serverAskedMs ?? 0, blockedMs));
}
