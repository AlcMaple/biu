import platform, { log } from "@/platform";

import type { Envelope, SyncOp, SyncStoreName } from "./types";

import { syncHttp } from "./http";

interface CachedToken {
  token: string;
  mid: string;
}

let cached: CachedToken | null = null;
/** 避免同一时刻多个 store 并发触发同步时，重复发起多次换 token 请求 */
let exchangeInFlight: Promise<CachedToken | null> | null = null;

async function exchangeToken(): Promise<CachedToken | null> {
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
    return null;
  }
}

async function getToken(): Promise<CachedToken | null> {
  if (cached) return cached;
  if (!exchangeInFlight) {
    exchangeInFlight = exchangeToken().finally(() => {
      exchangeInFlight = null;
    });
  }
  cached = await exchangeInFlight;
  return cached;
}

function invalidateToken() {
  cached = null;
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

    invalidateToken();
    const retried = await getToken();
    if (!retried) return null;
    return fn(retried);
  }
}

export async function pullSnapshot(store: SyncStoreName): Promise<Envelope | null> {
  return withAuthRetry(token =>
    syncHttp.get<Envelope>(`/sync/${store}`, {
      headers: { Authorization: `Bearer ${token.token}` },
    }),
  );
}

export async function pushOps(store: SyncStoreName, baseVersion: number, ops: SyncOp[]): Promise<Envelope | null> {
  return withAuthRetry(token =>
    syncHttp.post<Envelope>(
      `/sync/${store}`,
      { baseVersion, ops },
      { headers: { Authorization: `Bearer ${token.token}` } },
    ),
  );
}

export async function getCurrentMid(): Promise<string | null> {
  const token = await getToken();
  return token?.mid ?? null;
}
