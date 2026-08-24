import type { IncomingMessage, ServerResponse } from "node:http";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { resolveSession, type ResolvedWebSession, type WebSessionResolver } from "./auth/handler.js";
import { isCrossSiteRequest, readProxyBody, sendProxyJson, type ProxyNext } from "./proxy-common.js";

export const BIU_SYNC_PROXY_ROOT = "/__biu_sync";

const DEFAULT_SYNC_INTERNAL_ORIGIN = "http://127.0.0.1:3002";
const BILIBILI_NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const MAX_SYNC_BODY_BYTES = 2 * 1024 * 1024;
const SYNC_TOKEN_CACHE_MS = 100 * 60 * 1000;
const SYNC_UPSTREAM_TIMEOUT_MS = 70_000;
const SYNC_STORES = new Set(["favorites", "fav-items", "tags"]);

interface CachedSyncToken {
  expiresAt: number;
  mid: string;
  token: string;
}

export interface BiuSyncProxyHandlerOptions {
  now?: () => number;
  publicOrigin?: string;
  sessionResolver?: WebSessionResolver;
  syncInternalOrigin?: string;
}

export type BiuSyncProxyHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: ProxyNext,
) => Promise<boolean>;

class SyncProxyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function normalizeSyncInternalOrigin(value: string | undefined) {
  const url = new URL(value ?? process.env.BIU_SYNC_INTERNAL_ORIGIN ?? DEFAULT_SYNC_INTERNAL_ORIGIN);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("BIU_SYNC_INTERNAL_ORIGIN must be an HTTP(S) origin without path, query, or credentials");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("BIU_SYNC_INTERNAL_ORIGIN may use HTTP only for a loopback sync service");
  }
  return url;
}

function jsonResponse(response: ServerResponse, status: number, payload: unknown) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  sendProxyJson(response, status, payload);
}

function copySyncResponseHeaders(response: ServerResponse, upstream: Response) {
  for (const name of ["content-length", "content-type", "retry-after"] as const) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function pathFor(origin: URL, pathname: string, search = "") {
  return new URL(`${pathname}${search}`, origin).toString();
}

function assertSyncTokenPayload(value: unknown): asserts value is { mid: string; token: string } {
  if (typeof value !== "object" || value === null) {
    throw new SyncProxyError("sync authentication response is invalid", 502);
  }
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.token !== "string" ||
    payload.token.length < 16 ||
    typeof payload.mid !== "string" ||
    !/^\d+$/.test(payload.mid)
  ) {
    throw new SyncProxyError("sync authentication response is invalid", 502);
  }
}

async function requestSyncService(
  target: string,
  init: { body?: Buffer; headers: Record<string, string>; method: string; signal: AbortSignal },
) {
  try {
    return await fetch(target, {
      body: init.body && init.body.length > 0 ? new Uint8Array(init.body) : undefined,
      headers: init.headers,
      method: init.method,
      redirect: "manual",
      signal: init.signal,
    });
  } catch (error) {
    if (init.signal.aborted) throw error;
    throw new SyncProxyError("无法连接本地歌单同步服务", 502);
  }
}

class SyncTokenCache {
  private readonly entries = new Map<string, CachedSyncToken>();

  constructor(
    private readonly origin: URL,
    private readonly now: () => number,
  ) {}

  invalidate(sessionId: string) {
    this.entries.delete(sessionId);
  }

  async get(session: ResolvedWebSession, signal: AbortSignal): Promise<CachedSyncToken> {
    const now = this.now();
    const cached = this.entries.get(session.sessionId);
    if (cached && cached.expiresAt > now) return cached;

    const cookie = session.cookieHeaderFor(BILIBILI_NAV_URL);
    if (!cookie) throw new SyncProxyError("Web 登录态缺少 B 站凭据", 401);

    const body = Buffer.from(JSON.stringify({ cookie }));
    const upstream = await requestSyncService(pathFor(this.origin, "/api/auth/exchange"), {
      body,
      headers: {
        Accept: "application/json",
        "Content-Length": String(body.length),
        "Content-Type": "application/json; charset=utf-8",
      },
      method: "POST",
      signal,
    });

    if (upstream.status === 401 || upstream.status === 400) {
      await upstream.body?.cancel();
      throw new SyncProxyError("B 站登录态已失效，请重新登录", 401);
    }
    if (!upstream.ok) {
      await upstream.body?.cancel();
      throw new SyncProxyError("本地歌单同步服务暂不可用", 502);
    }

    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      throw new SyncProxyError("sync authentication response is invalid", 502);
    }
    assertSyncTokenPayload(payload);

    const entry: CachedSyncToken = {
      expiresAt: now + SYNC_TOKEN_CACHE_MS,
      mid: payload.mid,
      token: payload.token,
    };
    this.entries.set(session.sessionId, entry);
    return entry;
  }
}

function requestHeaders(request: IncomingMessage, token: string, body: Buffer): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "Biu-Web-Sync-BFF/1.0",
  };
  const contentType = request.headers["content-type"];
  const firstContentType = Array.isArray(contentType) ? contentType[0] : contentType;
  if (firstContentType) headers["Content-Type"] = firstContentType;
  if (body.length > 0) headers["Content-Length"] = String(body.length);
  return headers;
}

async function relaySyncResponse(
  request: IncomingMessage,
  response: ServerResponse,
  upstream: Response,
  signal: AbortSignal,
) {
  response.statusCode = upstream.status;
  copySyncResponseHeaders(response, upstream);
  if (request.method === "HEAD" || !upstream.body) {
    response.end();
    return;
  }
  await pipeline(Readable.fromWeb(upstream.body as unknown as NodeReadableStream), response, { signal });
}

function allowedSyncRoute(url: URL) {
  if (url.pathname === `${BIU_SYNC_PROXY_ROOT}/session`) return { kind: "session" as const };
  if (url.pathname === `${BIU_SYNC_PROXY_ROOT}/watch`) return { kind: "watch" as const };

  const prefix = `${BIU_SYNC_PROXY_ROOT}/sync/`;
  if (!url.pathname.startsWith(prefix)) return undefined;
  const store = url.pathname.slice(prefix.length);
  return SYNC_STORES.has(store) ? { kind: "sync" as const, store } : undefined;
}

export function createBiuSyncProxyHandler(options: BiuSyncProxyHandlerOptions = {}): BiuSyncProxyHandler {
  const origin = normalizeSyncInternalOrigin(options.syncInternalOrigin);
  const now = options.now ?? Date.now;
  const tokenCache = new SyncTokenCache(origin, now);
  const sessionResolver = options.sessionResolver ?? resolveSession;

  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://biu.local");
    const route = allowedSyncRoute(url);
    if (!route) {
      if (url.pathname === BIU_SYNC_PROXY_ROOT || url.pathname.startsWith(`${BIU_SYNC_PROXY_ROOT}/`)) {
        jsonResponse(response, 404, { code: -404, message: "本地歌单同步端点不存在" });
        return true;
      }
      next?.();
      return false;
    }

    const method = request.method ?? "GET";
    const allowedMethods = route.kind === "sync" ? new Set(["GET", "POST"]) : new Set(["GET"]);
    if (!allowedMethods.has(method)) {
      response.setHeader("Allow", [...allowedMethods].join(", "));
      jsonResponse(response, 405, { code: -405, message: "请求方法不被允许" });
      return true;
    }
    if (isCrossSiteRequest(request, options.publicOrigin)) {
      jsonResponse(response, 403, { code: -403, message: "跨站同步请求被拒绝" });
      return true;
    }
    if ((route.kind === "session" || route.kind === "sync") && url.search) {
      jsonResponse(response, 400, { code: -400, message: "同步请求参数不合法" });
      return true;
    }
    if (route.kind === "watch" && [...url.searchParams.keys()].some(name => name !== "versions")) {
      jsonResponse(response, 400, { code: -400, message: "同步请求参数不合法" });
      return true;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SYNC_UPSTREAM_TIMEOUT_MS);
    timeout.unref();
    request.once("aborted", () => controller.abort());
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });

    try {
      const session = await sessionResolver(request, response);
      if (!session) {
        jsonResponse(response, 401, { code: -101, message: "请先登录 B 站" });
        return true;
      }

      let credential = await tokenCache.get(session, controller.signal);
      if (route.kind === "session") {
        jsonResponse(response, 200, { code: 0, data: { mid: credential.mid }, message: "0" });
        return true;
      }

      const body = method === "POST" ? await readProxyBody(request, MAX_SYNC_BODY_BYTES) : Buffer.alloc(0);
      const pathname = route.kind === "watch" ? "/api/watch" : `/api/sync/${route.store}`;
      const target = pathFor(origin, pathname, route.kind === "watch" ? url.search : "");
      let upstream = await requestSyncService(target, {
        body,
        headers: requestHeaders(request, credential.token, body),
        method,
        signal: controller.signal,
      });

      // Sync JWT 过期或服务迁移后密钥轮换时，仅在服务端重新换发一次；浏览器始终拿不到 JWT。
      if (upstream.status === 401) {
        await upstream.body?.cancel();
        tokenCache.invalidate(session.sessionId);
        credential = await tokenCache.get(session, controller.signal);
        upstream = await requestSyncService(target, {
          body,
          headers: requestHeaders(request, credential.token, body),
          method,
          signal: controller.signal,
        });
      }

      await relaySyncResponse(request, response, upstream, controller.signal);
      return true;
    } catch (error) {
      if (response.writableEnded || response.destroyed || controller.signal.aborted) return true;
      if (error instanceof SyncProxyError) {
        jsonResponse(response, error.status, { code: -error.status, message: error.message });
        return true;
      }
      if ((error as { status?: unknown })?.status === 413) {
        jsonResponse(response, 413, { code: -413, message: "同步请求体过大" });
        return true;
      }
      jsonResponse(response, 502, { code: -502, message: "本地歌单同步服务请求失败" });
      return true;
    } finally {
      clearTimeout(timeout);
    }
  };
}
