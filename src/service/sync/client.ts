import type { CloudRanking, RankingEvent } from "@shared/play-ranking";

import platform, { log } from "@/platform";
import { isWeb } from "@/platform/detect";

import type { Envelope, SyncOp, SyncStoreName } from "./types";

import { WATCH_REQUEST_TIMEOUT_MS } from "./config";
import { syncHttp } from "./http";
import { isSyncPausedError } from "./safety-gate";

interface CachedToken {
  token: string;
  mid: string;
  signal: AbortSignal;
}

interface WebSyncSessionResponse {
  code: number;
  data?: { mid?: string };
}

let cached: CachedToken | null = null;
/** 避免同一时刻多个 store 并发触发同步时，重复发起多次换 token 请求 */
let exchangeInFlight: Promise<CachedToken | null> | null = null;
let tokenGeneration = 0;
let sessionAbort = new AbortController();

class SyncRequestError extends Error {
  readonly response?: { status: number; data?: { error: string } };
  constructor(
    message: string,
    readonly status?: number,
    publicError?: string,
  ) {
    super(message);
    if (status !== undefined) this.response = { status, ...(publicError ? { data: { error: publicError } } : {}) };
  }
}

function safeSyncError(error: unknown) {
  if (isSyncPausedError(error)) return error;
  if (error instanceof SyncRequestError) return error;
  const status = (error as { response?: { status?: number } })?.response?.status;
  const message =
    status === 429
      ? "同步请求过多，本地改动已保留"
      : status !== undefined && status >= 500
        ? `同步服务暂不可用（HTTP ${status}），本地改动已保留`
        : status === 401
          ? "同步登录已失效，本地改动已保留"
          : status === 409
            ? "同步账号或版本已变化，本地改动已保留"
            : status
              ? `同步请求失败（HTTP ${status}）`
              : "同步连接未完成，本地改动已保留";
  // Axios错误可能带Cookie/JWT配置，日志只传播状态和固定文案。
  const detail = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  const publicError =
    status !== undefined &&
    status < 500 &&
    typeof detail === "string" &&
    detail.length <= 256 &&
    !/SESSDATA|Bearer|token|cookie|PRIVATE KEY|authorization/i.test(detail)
      ? detail
      : undefined;
  return new SyncRequestError(message, status, publicError);
}

async function exchangeToken(): Promise<CachedToken | null> {
  const signal = sessionAbort.signal;
  if (isWeb) {
    try {
      const res = await syncHttp.get<WebSyncSessionResponse>("/session", { signal });
      const mid = res.data?.mid;
      return res.code === 0 && typeof mid === "string" && /^\d+$/.test(mid) ? { token: "", mid, signal } : null;
    } catch (err) {
      if (isSyncPausedError(err)) throw err;
      if (signal.aborted) return null;
      log.warn("[sync/client] Web sync session unavailable", safeSyncError(err));
      return null;
    }
  }

  const sessdata = await platform.getCookie("SESSDATA");
  if (signal.aborted) return null;
  if (!sessdata) {
    // 未登录：本地歌单同步依附于 B 站登录态，没登录就不同步，不算错误
    return null;
  }

  try {
    const res = await syncHttp.post<{ token: string; mid: string }>(
      "/auth/exchange",
      {
        cookie: `SESSDATA=${sessdata}`,
      },
      { signal },
    );
    return { token: res.token, mid: res.mid, signal };
  } catch (err) {
    if (isSyncPausedError(err)) throw err;
    if (signal.aborted) return null;
    log.warn("[sync/client] token exchange failed", safeSyncError(err));
    return null;
  }
}

async function getToken(): Promise<CachedToken | null> {
  if (cached) return cached;
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

export function invalidateSyncToken() {
  sessionAbort.abort();
  sessionAbort = new AbortController();
  tokenGeneration += 1;
  exchangeInFlight = null;
  cached = null;
}

export async function fetchCloudRanking(expectedMid: string): Promise<CloudRanking | null> {
  return withAuthRetry(token => {
    if (token.mid !== expectedMid) throw new SyncRequestError("账号已变化，请重新同步排行", 409);
    const headers = authHeaders(token);
    return syncHttp.get<CloudRanking>("/play-ranking", { headers, signal: token.signal });
  });
}

export async function pushRankingEvents(
  expectedMid: string,
  deviceId: string,
  events: RankingEvent[],
): Promise<CloudRanking | null> {
  return withAuthRetry(token => {
    if (token.mid !== expectedMid) throw new SyncRequestError("账号已变化，原账号记录已保留", 409);
    const headers = authHeaders(token);
    return syncHttp.post<CloudRanking>(
      "/play-ranking",
      { expectedMid, deviceId, events },
      { headers, signal: token.signal },
    );
  });
}

function authHeaders(token: CachedToken) {
  return isWeb ? { "X-Biu-Expected-Mid": token.mid } : { Authorization: `Bearer ${token.token}` };
}

// 401只允许同账号重放；Cookie或会话已改变时，旧操作留在原账号，不换身份再提交。
async function withAuthRetry<T>(fn: (token: CachedToken) => Promise<T>, expectedMid?: string): Promise<T | null> {
  const generation = tokenGeneration;
  const token = await getToken();
  if (!token || generation !== tokenGeneration || (expectedMid !== undefined && token.mid !== expectedMid)) return null;

  try {
    const result = await fn(token);
    return generation === tokenGeneration ? result : null;
  } catch (err) {
    if (generation !== tokenGeneration) return null;
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status !== 401) throw safeSyncError(err);

    invalidateSyncToken();
    const retryGeneration = tokenGeneration;
    const retried = await getToken();
    if (!retried || retryGeneration !== tokenGeneration || retried.mid !== token.mid) return null;
    try {
      const result = await fn(retried);
      return retryGeneration === tokenGeneration ? result : null;
    } catch (error) {
      if (retryGeneration !== tokenGeneration) return null;
      throw safeSyncError(error);
    }
  }
}

export async function pullSnapshot(store: SyncStoreName, expectedMid?: string): Promise<Envelope | null> {
  return withAuthRetry(token => {
    const headers = authHeaders(token);
    return syncHttp.get<Envelope>(`/sync/${store}`, { headers, signal: token.signal });
  }, expectedMid);
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
  expectedMid?: string,
): Promise<Envelope | null> {
  return withAuthRetry(token => {
    const headers = authHeaders(token);
    return syncHttp.post<Envelope>(
      `/sync/${store}`,
      { allowFullDelete, baseVersion, ops },
      { headers, signal: token.signal },
    );
  }, expectedMid);
}

export interface WatchResult {
  changed: boolean;
  versions: Record<string, number>;
}

/**
 * 长轮询：带上本机已知的各 store 版本号，服务端在有变化时立刻返回、否则挂起约 25s。
 * 超时属于正常返回（`changed: false`），调用方直接发起下一轮即可。
 */
export async function watchVersions(known: Record<string, number>, expectedMid?: string): Promise<WatchResult | null> {
  const query = Object.entries(known)
    .map(([store, version]) => `${store}:${version}`)
    .join(",");
  return withAuthRetry(token => {
    const headers = authHeaders(token);
    return syncHttp.get<WatchResult>(`/watch?versions=${encodeURIComponent(query)}`, {
      headers,
      signal: token.signal,
      timeout: WATCH_REQUEST_TIMEOUT_MS,
    });
  }, expectedMid);
}

export const getKnownSyncMid = () => cached?.mid;

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
    const headers = authHeaders(token);
    return syncHttp.post<{ code: string; count: number }>("/share", payload, { headers, signal: token.signal });
  });
}
