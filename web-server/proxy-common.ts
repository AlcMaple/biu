import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http";

import http from "node:http";
import https from "node:https";
import { pipeline } from "node:stream/promises";

export const BILIBILI_PROXY_REQUEST_HEADERS = {
  "Accept-Encoding": "identity",
  Origin: "https://www.bilibili.com",
  Referer: "https://www.bilibili.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
} as const;

const RESPONSE_HEADER_ALLOWLIST = new Set([
  "accept-ranges",
  "bili-status-code",
  "bili-trace-id",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-length",
  "content-range",
  "content-type",
  "date",
  "etag",
  "expires",
  "last-modified",
  "retry-after",
  "x-bili-gaia-vvoucher",
  "x-bili-metadata-ip-region",
  "x-bili-trace-id",
]);

export type ProxyKind = "api" | "media";

export interface ProxyLogger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface ProxyWebSession {
  cookieHeaderFor: (target: string | URL) => string;
  sessionId: string;
  updateFromSetCookie: (setCookies: string[], responseUrl: string | URL) => Promise<void> | void;
}

export type ProxyWebSessionProvider = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<ProxyWebSession | undefined>;

export type ProxyNext = (error?: unknown) => void;
export type UpstreamMapper = (target: URL, kind: ProxyKind) => URL;

export class ProxyRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const firstHeader = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function sendProxyJson(response: ServerResponse, status: number, payload: unknown) {
  if (response.headersSent || response.writableEnded) return;
  const body = Buffer.from(JSON.stringify(payload));
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", body.length);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(body);
}

export function normalizePublicOrigin(value: string | undefined) {
  if (!value) return undefined;

  const url = new URL(value);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("BIU_WEB_PUBLIC_ORIGIN must be an HTTP(S) origin without path, query, or credentials");
  }
  return url.origin;
}

export function isCrossSiteRequest(request: IncomingMessage, publicOrigin?: string) {
  if (request.headers["sec-fetch-site"] === "cross-site") return true;

  const host = request.headers.host;

  try {
    const expectedOrigin = new URL(
      publicOrigin ?? `${"encrypted" in request.socket && request.socket.encrypted ? "https" : "http"}://${host}`,
    );
    if (!host || host !== expectedOrigin.host) return true;

    const origin = firstHeader(request.headers.origin);
    return origin ? new URL(origin).origin !== expectedOrigin.origin : false;
  } catch {
    return true;
  }
}

export function isCrossSiteMutation(request: IncomingMessage, publicOrigin?: string) {
  if ((request.method ?? "GET") === "GET" || (request.method ?? "GET") === "HEAD") return false;
  return isCrossSiteRequest(request, publicOrigin);
}

export async function readProxyBody(stream: AsyncIterable<unknown>, limit: number) {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) throw new ProxyRequestError("request body is too large", 413);
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export function createUpstreamRequestHeaders(
  request: IncomingMessage,
  options: { body: Buffer; cookie?: string; includeRange?: boolean },
) {
  const headers: OutgoingHttpHeaders = { ...BILIBILI_PROXY_REQUEST_HEADERS };
  const accept = firstHeader(request.headers.accept);
  const acceptLanguage = firstHeader(request.headers["accept-language"]);
  const contentType = firstHeader(request.headers["content-type"]);
  if (accept) headers.Accept = accept;
  if (acceptLanguage) headers["Accept-Language"] = acceptLanguage;
  if (contentType) headers["Content-Type"] = contentType;
  if (options.body.length > 0) headers["Content-Length"] = options.body.length;
  if (options.cookie) headers.Cookie = options.cookie;

  if (options.includeRange) {
    for (const name of ["if-modified-since", "if-none-match", "if-range", "range"] as const) {
      const value = firstHeader(request.headers[name]);
      if (value) headers[name] = value;
    }
  }

  return headers;
}

export function copyUpstreamResponseHeaders(
  response: ServerResponse,
  headers: IncomingHttpHeaders,
  bodyChanged = false,
) {
  for (const [name, value] of Object.entries(headers)) {
    if (!RESPONSE_HEADER_ALLOWLIST.has(name) || value === undefined) continue;
    if (bodyChanged && (name === "content-encoding" || name === "content-length")) continue;
    response.setHeader(name, value);
  }
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function requestTransport(target: URL) {
  if (target.protocol === "https:") return https;
  if (target.protocol === "http:") return http;
  throw new ProxyRequestError("unsupported upstream protocol", 502);
}

export interface UpstreamRequestInput {
  body: Buffer;
  headers: OutgoingHttpHeaders;
  kind: ProxyKind;
  mapUpstreamForTest?: UpstreamMapper;
  method: string;
  signal: AbortSignal;
  target: URL;
}

export function openUpstream(
  input: UpstreamRequestInput,
  onResponse: (response: IncomingMessage) => void,
): ClientRequest {
  const actualTarget = input.mapUpstreamForTest?.(new URL(input.target), input.kind) ?? input.target;
  const request = requestTransport(actualTarget).request(
    actualTarget,
    {
      headers: input.headers,
      method: input.method,
      signal: input.signal,
    },
    onResponse,
  );
  request.setTimeout(30_000, () => request.destroy(new Error("Bilibili upstream timed out")));
  request.end(input.body.length > 0 ? input.body : undefined);
  return request;
}

export async function relayUpstreamStream(
  upstream: IncomingMessage,
  downstream: ServerResponse,
  input: UpstreamRequestInput,
) {
  downstream.statusCode = upstream.statusCode ?? 502;
  copyUpstreamResponseHeaders(downstream, upstream.headers);
  if (input.kind === "api") downstream.setHeader("Cache-Control", "no-store");
  if (input.kind === "media") {
    // B 站 CDN 把音频 m4s 标成 application/octet-stream。桌面 <audio> 能容忍，但 iOS/移动端
    // 在我们同时下发 nosniff 的情况下会拒绝解码（readyState 卡 0、一直 loading、buffered 0）。
    // web 端这些媒体流只经 <audio> 播放（渲染层无 <video>），统一声明为 audio/mp4 才能在 iOS 播放。
    downstream.setHeader("Content-Type", "audio/mp4");
  }
  if (input.method === "HEAD") {
    upstream.resume();
    downstream.end();
    return;
  }
  await pipeline(upstream, downstream, { signal: input.signal });
}

export function requestAndRelayStream(
  input: UpstreamRequestInput,
  downstream: ServerResponse,
  options: {
    redirectsLeft?: number;
    validateRedirect?: (target: URL) => boolean;
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upstreamRequest = openUpstream(input, upstream => {
      void (async () => {
        const status = upstream.statusCode ?? 502;
        const location = firstHeader(upstream.headers.location);

        if (location && [301, 302, 303, 307, 308].includes(status) && options.validateRedirect) {
          upstream.resume();
          if ((options.redirectsLeft ?? 0) <= 0) throw new ProxyRequestError("too many upstream redirects", 502);

          const redirected = new URL(location, input.target);
          if (!options.validateRedirect(redirected)) throw new ProxyRequestError("redirect target is not allowed", 502);
          await requestAndRelayStream({ ...input, target: redirected }, downstream, {
            ...options,
            redirectsLeft: (options.redirectsLeft ?? 0) - 1,
          });
          return;
        }

        await relayUpstreamStream(upstream, downstream, input);
      })().then(resolve, reject);
    });
    upstreamRequest.once("error", reject);
  });
}
