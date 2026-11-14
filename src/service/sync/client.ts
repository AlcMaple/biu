import type { CloudRanking, RankingEvent } from "@shared/play-ranking";

import platform, { log } from "@/platform";
import { isWeb } from "@/platform/detect";

import type { Envelope, SyncOp, SyncStoreName } from "./types";

import { WATCH_REQUEST_TIMEOUT_MS } from "./config";
import { syncHttp } from "./http";

interface CachedToken {
  token: string;
  mid: string;
}

interface WebSyncSessionResponse {
  code: number;
  data?: { mid?: string };
}

let cached: CachedToken | null = null;
/** 避免同一时刻多个 store 并发触发同步时，重复发起多次换 token 请求 */
// 换 token 会让同步服务器（网页版经 BFF）去问 B 站「这是谁」，所有用户共用服务器的出口 IP。
// 失败后如果每次重连、每次回到前台都再换一次，B 站风控期间就是全体用户一起硬闯，
// 所以失败后按服务器给的 Retry-After 停手，期间直接当作没有 token，不发请求。
const EXCHANGE_FAILED_WAIT_MS = 60_000;
const EXCHANGE_REJECTED_WAIT_MS = 5 * 60_000;
const COOKIE_INVALID_WAIT_MS = 10 * 60_000;
let exchangeBlockedUntil = 0;

export function retryAfterMs(err: unknown): number | undefined {
  const header = (err as { response?: { headers?: Record<string, unknown> } })?.response?.headers?.["retry-after"];
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

function blockExchange(err: unknown) {
  const status = (err as { response?: { status?: number } })?.response?.status;
  const wait =
    retryAfterMs(err) ??
    (status === 401
      ? COOKIE_INVALID_WAIT_MS
      : status === 503 || status === 429
        ? EXCHANGE_REJECTED_WAIT_MS
        : EXCHANGE_FAILED_WAIT_MS);
  exchangeBlockedUntil = Date.now() + wait;
  log.warn(`[sync/client] 换取同步凭证失败（${status ?? "网络错误"}），${Math.round(wait / 1000)}s 内不再尝试`);
}

export function syncBlockedForMs(): number {
  return Math.max(0, exchangeBlockedUntil - Date.now());
}

let exchangeInFlight: Promise<CachedToken | null> | null = null;
let tokenGeneration = 0;

async function exchangeToken(): Promise<CachedToken | null> {
  if (isWeb) {
    try {
      const res = await syncHttp.get<WebSyncSessionResponse>("/session");
      const mid = res.data?.mid;
      return res.code === 0 && typeof mid === "string" && /^\d+$/.test(mid) ? { token: "", mid } : null;
    } catch (err) {
      log.warn("[sync/client] Web sync session unavailable", err);
      blockExchange(err);
      return null;
    }
  }

  const sessdata = await platform.getCookie("SESSDATA");
  if (!sessdata) {
    // 未登录：本地歌单同步依附于 B 站登录态，没登录就不同步，不算错误
    return null;
  }

  try {
    const res = await syncHttp.post<{ token: string; mid: string }>("/auth/exchange", {
      cookie: `SESSDATA=${sessdata}`,
    });
    return { token: res.token, mid: res.mid };
  } catch (err) {
    log.warn("[sync/client] token exchange failed", err);
    blockExchange(err);
    return null;
  }
}

async function getToken(): Promise<CachedToken | null> {
  if (cached) return cached;
  if (syncBlockedForMs() > 0) return null;
  const generation = tokenGeneration;
  if (!exchangeInFlight) {
    const request = exchangeToken().finally(() => {
      if (exchangeInFlight === request) exchangeInFlight = null;
    });
    exchangeInFlight = request;
  }
  const result = await exchangeInFlight;
  if (generation !== tokenGeneration) return null;
  cached = result;
  return cached;
}

export function invalidateSyncToken({ clearBlock = false } = {}) {
  if (clearBlock) exchangeBlockedUntil = 0;
  tokenGeneration += 1;
  exchangeInFlight = null;
  cached = null;
}

export async function fetchCloudRanking(expectedMid: string): Promise<CloudRanking | null> {
  return withAuthRetry(token => {
    if (token.mid !== expectedMid) throw new Error("账号已变化，请重新同步排行");
    const headers = token.token ? { Authorization: `Bearer ${token.token}` } : undefined;
    return syncHttp.get<CloudRanking>("/play-ranking", { headers });
  });
}

export async function pushRankingEvents(
  expectedMid: string,
  deviceId: string,
  events: RankingEvent[],
): Promise<CloudRanking | null> {
  return withAuthRetry(token => {
    if (token.mid !== expectedMid) throw new Error("账号已变化，原账号记录已保留");
    const headers = token.token ? { Authorization: `Bearer ${token.token}` } : undefined;
    return syncHttp.post<CloudRanking>("/play-ranking", { expectedMid, deviceId, events }, { headers });
  });
}

/** 401 时重新换一次 token 再试一次，仍失败就放弃（不做无限重试） */
async function withAuthRetry<T>(fn: (token: CachedToken) => Promise<T>): Promise<T | null> {
  const token = await getToken();
  if (!token) return null;

  try {
    return await fn(token);
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status !== 401) throw err;

    invalidateSyncToken();
    const retried = await getToken();
    if (!retried) return null;
    return fn(retried);
  }
}

export async function pullSnapshot(store: SyncStoreName): Promise<Envelope | null> {
  return withAuthRetry(token => {
    const headers = token.token ? { Authorization: `Bearer ${token.token}` } : undefined;
    return syncHttp.get<Envelope>(`/sync/${store}`, { headers });
  });
}

/**
 * @param allowFullDelete 这批操作会删光该 store 的全部条目，且客户端**确认这是用户
 * 本人删的**（本次会话里亲眼见过它有内容、现在被删空了）。服务端的全量删除闸门只在
 * 没有这个确认时才拦截——用于挡住"状态没就绪所以看起来是空的"这类客户端故障。
 */
export async function pushOps(
  store: SyncStoreName,
  baseVersion: number,
  ops: SyncOp[],
  allowFullDelete = false,
): Promise<Envelope | null> {
  return withAuthRetry(token => {
    const headers = token.token ? { Authorization: `Bearer ${token.token}` } : undefined;
    return syncHttp.post<Envelope>(`/sync/${store}`, { allowFullDelete, baseVersion, ops }, { headers });
  });
}

export interface WatchResult {
  changed: boolean;
  versions: Record<string, number>;
}

/**
 * 长轮询：带上本机已知的各 store 版本号，服务端在有变化时立刻返回、否则挂起约 25s。
 * 超时属于正常返回（`changed: false`），调用方直接发起下一轮即可。
 */
export async function watchVersions(known: Record<string, number>): Promise<WatchResult | null> {
  const query = Object.entries(known)
    .map(([store, version]) => `${store}:${version}`)
    .join(",");
  return withAuthRetry(token => {
    const headers = token.token ? { Authorization: `Bearer ${token.token}` } : undefined;
    return syncHttp.get<WatchResult>(`/watch?versions=${encodeURIComponent(query)}`, {
      headers,
      timeout: WATCH_REQUEST_TIMEOUT_MS,
    });
  });
}

export async function getCurrentMid(): Promise<string | null> {
  const token = await getToken();
  return token?.mid ?? null;
}

export interface SharePublishPayload {
  folderId: number;
  title: string;
  cover?: string;
  ownerName?: string;
  items: unknown[];
}

export async function publishFolderShare(
  payload: SharePublishPayload,
): Promise<{ code: string; count: number } | null> {
  return withAuthRetry(token => {
    const headers = token.token ? { Authorization: `Bearer ${token.token}` } : undefined;
    return syncHttp.post<{ code: string; count: number }>("/share", payload, { headers });
  });
}
