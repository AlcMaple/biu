import type { IncomingMessage, ServerResponse } from "node:http";

import { WEB_LYRICS_PROXY_PATHS, WEB_LYRICS_PROXY_ROOT } from "../shared/web-lyrics-proxy.js";
import {
  isCrossSiteRequest,
  ProxyRequestError,
  sendProxyJson,
  type ProxyLogger,
  type ProxyNext,
} from "./proxy-common.js";

const NETEASE_ORIGIN = "https://interface.music.163.com";
const LRCLIB_ORIGIN = "https://lrclib.net";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_QUERY_LENGTH = 256;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const UPSTREAM_HEADERS = {
  Accept: "application/json",
  "Accept-Encoding": "identity",
  "User-Agent": "Biu-Web-Lyrics-BFF/1.0",
} as const;

type LyricsRoute = {
  target: URL;
};

export interface WebLyricsProxyHandlerOptions {
  fetch?: typeof fetch;
  logger?: ProxyLogger;
  publicOrigin?: string;
  timeoutMs?: number;
}

export type WebLyricsProxyHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: ProxyNext,
) => Promise<boolean>;

function hasLyricsRoot(pathname: string) {
  return pathname === WEB_LYRICS_PROXY_ROOT || pathname.startsWith(`${WEB_LYRICS_PROXY_ROOT}/`);
}

function assertAllowedQuery(url: URL, allowed: ReadonlySet<string>) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new ProxyRequestError("歌词请求参数不合法", 400);
  }
}

function readSingleQuery(url: URL, name: string, required: boolean) {
  const values = url.searchParams.getAll(name);
  if (values.length > 1 || (required && values.length === 0)) {
    throw new ProxyRequestError("歌词请求参数不合法", 400);
  }
  return values[0];
}

function readTextQuery(url: URL, name: string, required: boolean) {
  const raw = readSingleQuery(url, name, required);
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (!value || value.length > MAX_QUERY_LENGTH) throw new ProxyRequestError("歌词请求参数不合法", 400);
  return value;
}

function readIntegerQuery(url: URL, name: string, fallback: number, min: number, max: number) {
  const raw = readSingleQuery(url, name, false);
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new ProxyRequestError("歌词请求参数不合法", 400);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ProxyRequestError("歌词请求参数不合法", 400);
  }
  return value;
}

function matchLyricsRoute(url: URL): LyricsRoute | undefined {
  if (url.pathname === WEB_LYRICS_PROXY_PATHS.neteaseSearch) {
    assertAllowedQuery(url, new Set(["s", "type", "limit", "offset"]));
    const target = new URL("/api/search/get", NETEASE_ORIGIN);
    target.searchParams.set("s", readTextQuery(url, "s", true)!);
    target.searchParams.set("type", String(readIntegerQuery(url, "type", 1, 1, 1000)));
    target.searchParams.set("limit", String(readIntegerQuery(url, "limit", 20, 1, 100)));
    target.searchParams.set("offset", String(readIntegerQuery(url, "offset", 0, 0, 10_000)));
    return { target };
  }

  if (url.pathname === WEB_LYRICS_PROXY_PATHS.neteaseLyrics) {
    assertAllowedQuery(url, new Set(["id"]));
    const target = new URL("/api/song/lyric", NETEASE_ORIGIN);
    const id = readIntegerQuery(url, "id", 0, 1, Number.MAX_SAFE_INTEGER);
    target.searchParams.set("id", String(id));
    target.searchParams.set("tv", "-1");
    target.searchParams.set("lv", "-1");
    target.searchParams.set("rv", "-1");
    target.searchParams.set("kv", "-1");
    target.searchParams.set("_nmclfl", "1");
    return { target };
  }

  if (url.pathname === WEB_LYRICS_PROXY_PATHS.lrclibSearch) {
    assertAllowedQuery(url, new Set(["q", "track_name", "artist_name", "album_name"]));
    const target = new URL("/api/search", LRCLIB_ORIGIN);
    for (const name of ["q", "track_name", "artist_name", "album_name"] as const) {
      const value = readTextQuery(url, name, name === "q");
      if (value !== undefined) target.searchParams.set(name, value);
    }
    return { target };
  }

  return undefined;
}

async function readResponseBody(upstream: Response, limit: number) {
  if (!upstream.body) return "";

  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ProxyRequestError("歌词服务响应过大", 502);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString("utf8");
}

function upstreamHeaders(target: URL): HeadersInit {
  if (target.origin === NETEASE_ORIGIN) {
    return {
      ...UPSTREAM_HEADERS,
      Origin: "https://music.163.com",
      Referer: "https://music.163.com/",
    };
  }
  return UPSTREAM_HEADERS;
}

export function createWebLyricsProxyHandler(options: WebLyricsProxyHandlerOptions = {}): WebLyricsProxyHandler {
  const fetchUpstream = options.fetch ?? fetch;
  const logger = options.logger ?? console;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://biu.local");
    if (!hasLyricsRoot(url.pathname)) {
      next?.();
      return false;
    }

    let route: LyricsRoute | undefined;
    try {
      route = matchLyricsRoute(url);
      if (!route) {
        sendProxyJson(response, 404, { code: -404, message: "歌词搜索端点不存在" });
        return true;
      }
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        sendProxyJson(response, 405, { code: -405, message: "歌词搜索只允许 GET 请求" });
        return true;
      }
      if (isCrossSiteRequest(request, options.publicOrigin)) {
        sendProxyJson(response, 403, { code: -403, message: "跨站歌词请求被拒绝" });
        return true;
      }
    } catch (error) {
      if (error instanceof ProxyRequestError) {
        sendProxyJson(response, error.status, { code: -error.status, message: error.message });
        return true;
      }
      sendProxyJson(response, 400, { code: -400, message: "歌词请求参数不合法" });
      return true;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timeout.unref();
    let clientAborted = false;
    const abortUpstream = () => {
      clientAborted = true;
      controller.abort();
    };
    const abortOnPrematureClose = () => {
      if (!response.writableEnded) abortUpstream();
    };
    request.once("aborted", abortUpstream);
    response.once("close", abortOnPrematureClose);

    try {
      const upstream = await fetchUpstream(route.target, {
        headers: upstreamHeaders(route.target),
        method: "GET",
        redirect: "error",
        signal: controller.signal,
      });
      if (!upstream.ok) throw new ProxyRequestError("歌词服务暂不可用", 502);

      const body = await readResponseBody(upstream, MAX_RESPONSE_BYTES);
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new ProxyRequestError("歌词服务返回数据无效", 502);
      }
      sendProxyJson(response, 200, payload);
    } catch (error) {
      if (response.writableEnded || response.destroyed || clientAborted) return true;
      if (timedOut) {
        logger.warn("[web-lyrics] upstream request timed out");
        sendProxyJson(response, 504, { code: -504, message: "歌词服务响应超时" });
        return true;
      }
      if (error instanceof ProxyRequestError) {
        logger.warn("[web-lyrics] upstream request failed", error.message);
        sendProxyJson(response, error.status, { code: -error.status, message: error.message });
      } else {
        logger.warn("[web-lyrics] upstream request failed", error);
        sendProxyJson(response, 502, { code: -502, message: "歌词服务暂不可用" });
      }
    } finally {
      clearTimeout(timeout);
      request.off("aborted", abortUpstream);
      response.off("close", abortOnPrematureClose);
    }
    return true;
  };
}
