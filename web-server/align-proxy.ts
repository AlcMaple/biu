import type { IncomingMessage, ServerResponse } from "node:http";

import { matchAlignRoute, WEB_ALIGN_PROXY_ROOT } from "../shared/lyrics-align.js";
import { resolveSession, type WebSessionResolver } from "./auth/handler.js";
import { isCrossSiteRequest, readProxyBody, sendProxyJson, type ProxyNext } from "./proxy-common.js";
import { isLoopbackHostname, SyncProxyError, SyncTokenCache } from "./sync-proxy.js";

// 对齐服务和 Web 服务同在一台机器，走本机端口；token 和同步服务共用（同一个 JWT_SECRET），从同步服务换
const DEFAULT_ALIGN_INTERNAL_ORIGIN = "http://127.0.0.1:3003";
const DEFAULT_SYNC_INTERNAL_ORIGIN = "http://127.0.0.1:3002";
const MAX_ALIGN_BODY_BYTES = 256 * 1024;
const ALIGN_UPSTREAM_TIMEOUT_MS = 20_000;

export interface BiuAlignProxyHandlerOptions {
  alignInternalOrigin?: string;
  now?: () => number;
  publicOrigin?: string;
  sessionResolver?: WebSessionResolver;
  syncInternalOrigin?: string;
}

export type BiuAlignProxyHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: ProxyNext,
) => Promise<boolean>;

function internalOrigin(value: string, name: string) {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    (url.protocol === "http:" && !isLoopbackHostname(url.hostname))
  ) {
    throw new Error(`${name} must be an HTTPS origin, or HTTP on loopback, without path or credentials`);
  }
  return url;
}

// 和对齐服务自己的错误同形（{ error: { code, message } }），客户端只认这一种
function errorJson(response: ServerResponse, status: number, message: string) {
  response.setHeader("Cache-Control", "no-store");
  sendProxyJson(response, status, { error: { code: "BFF", message } });
}

export function createBiuAlignProxyHandler(options: BiuAlignProxyHandlerOptions = {}): BiuAlignProxyHandler {
  const alignOrigin = internalOrigin(
    options.alignInternalOrigin ?? process.env.BIU_ALIGN_INTERNAL_ORIGIN ?? DEFAULT_ALIGN_INTERNAL_ORIGIN,
    "BIU_ALIGN_INTERNAL_ORIGIN",
  );
  const syncOrigin = internalOrigin(
    options.syncInternalOrigin ?? process.env.BIU_SYNC_INTERNAL_ORIGIN ?? DEFAULT_SYNC_INTERNAL_ORIGIN,
    "BIU_SYNC_INTERNAL_ORIGIN",
  );
  const tokenCache = new SyncTokenCache(syncOrigin, options.now ?? Date.now);
  const sessionResolver = options.sessionResolver ?? resolveSession;

  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://biu.local");
    if (url.pathname !== WEB_ALIGN_PROXY_ROOT && !url.pathname.startsWith(`${WEB_ALIGN_PROXY_ROOT}/`)) {
      next?.();
      return false;
    }
    const path = `${url.pathname.slice(WEB_ALIGN_PROXY_ROOT.length)}${url.search}`;
    const method = request.method ?? "GET";
    const route = matchAlignRoute(method, path);
    if (!route) {
      errorJson(response, 404, "不支持的歌词对齐请求");
      return true;
    }
    if (isCrossSiteRequest(request, options.publicOrigin)) {
      errorJson(response, 403, "跨站请求被拒绝");
      return true;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ALIGN_UPSTREAM_TIMEOUT_MS);
    timeout.unref();
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });

    try {
      const session = route.auth ? await sessionResolver(request, response) : undefined;
      if (route.auth && !session) {
        errorJson(response, 401, "请先登录 B 站，歌词对齐要用登录身份记录每日次数和提交");
        return true;
      }
      const body = method === "POST" ? await readProxyBody(request, MAX_ALIGN_BODY_BYTES) : Buffer.alloc(0);
      const target = new URL(`/api${path}`, alignOrigin).toString();
      const send = (token?: string) =>
        fetch(target, {
          body: body.length ? new Uint8Array(body) : undefined,
          headers: {
            Accept: "application/json",
            ...(body.length ? { "Content-Type": "application/json", "Content-Length": String(body.length) } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          method,
          redirect: "manual",
          signal: controller.signal,
        });

      let upstream = await send(session ? (await tokenCache.get(session, controller.signal)).token : undefined);
      if (upstream.status === 401 && session) {
        await upstream.body?.cancel();
        tokenCache.invalidate(session.sessionId);
        upstream = await send((await tokenCache.get(session, controller.signal)).token);
      }

      const text = await upstream.text();
      response.statusCode = upstream.status;
      response.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.end(text);
      return true;
    } catch (error) {
      if (response.writableEnded || response.destroyed) return true;
      if (controller.signal.aborted) {
        errorJson(response, 504, "歌词对齐服务响应超时，请稍后再试");
        return true;
      }
      if (error instanceof SyncProxyError) {
        errorJson(response, error.status, error.status === 401 ? error.message : "登录服务暂时不可用，请稍后再试");
        return true;
      }
      if ((error as { status?: unknown })?.status === 413) {
        errorJson(response, 413, "歌词太长了，请检查是不是粘贴了多首");
        return true;
      }
      errorJson(response, 502, "连不上歌词对齐服务，请稍后再试");
      return true;
    } finally {
      clearTimeout(timeout);
    }
  };
}
