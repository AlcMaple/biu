import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

import type { MediaSafetyGate } from "./media-safety-runtime.js";

import { acceptsGzip, gzipBody, markGzipped } from "./compression.js";
import { findCsrfInCookieHeader, injectCsrfIntoBody, injectCsrfIntoQuery, readCsrfFromCookieHeader } from "./csrf.js";
import { isBilibiliMediaResponse } from "./media-response.js";
import { MediaSafetyPausedError } from "./media-safety-store.js";
import {
  ProxyRequestError,
  copyUpstreamResponseHeaders,
  createUpstreamRequestHeaders,
  firstHeader,
  isCrossSiteMutation,
  isCrossSiteRequest,
  normalizePublicOrigin,
  openUpstream,
  readProxyBody,
  relayUpstreamStream,
  sendProxyJson,
  type ProxyLogger,
  type ProxyNext,
  type ProxyWebSession,
  type ProxyWebSessionProvider,
  type UpstreamMapper,
  type UpstreamRequestInput,
} from "./proxy-common.js";
import { matchBilibiliApiProxyRequest } from "./routes.js";

const API_METHODS = new Set(["GET", "HEAD", "POST"]);
const MAX_API_BODY_BYTES = 32 * 1024 * 1024;
const AUTH_PATH_PREFIXES = ["/correspond/", "/login/", "/x/passport-login/", "/x/passport-tv-login/"] as const;

export interface ApiResponseTransformContext {
  request: IncomingMessage;
  response: ServerResponse;
  session?: ProxyWebSession;
  status: number;
  target: URL;
  upstreamHeaders: IncomingHttpHeaders;
}

export interface ApiResponseTransformer {
  matches: (target: URL) => boolean;
  maxBytes: number;
  transform: (body: Buffer, context: ApiResponseTransformContext) => Buffer | Promise<Buffer>;
}

export function composeApiResponseTransformers(...transformers: ApiResponseTransformer[]): ApiResponseTransformer {
  return {
    matches: target => transformers.some(transformer => transformer.matches(target)),
    maxBytes: Math.max(...transformers.map(transformer => transformer.maxBytes)),
    async transform(body, context) {
      let transformed = body;
      for (const transformer of transformers) {
        if (transformer.matches(context.target)) transformed = await transformer.transform(transformed, context);
      }
      return transformed;
    },
  };
}

export interface BilibiliApiProxyHandlerOptions {
  logger?: ProxyLogger;
  mediaSafetyStore?: MediaSafetyGate;
  mapUpstreamForTest?: UpstreamMapper;
  publicOrigin?: string;
  responseTransformer?: ApiResponseTransformer;
  sessionProvider?: ProxyWebSessionProvider;
}

export type BilibiliApiProxyHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: ProxyNext,
) => Promise<boolean>;

function isGenericAuthenticationPath(target: URL) {
  return AUTH_PATH_PREFIXES.some(prefix => target.pathname.startsWith(prefix));
}

async function proxyApiResponse(
  input: UpstreamRequestInput,
  request: IncomingMessage,
  response: ServerResponse,
  session: ProxyWebSession | undefined,
  transformer: ApiResponseTransformer | undefined,
  safetyStore?: MediaSafetyGate,
) {
  if (input.signal.aborted) throw new Error("request cancelled before playback admission");
  const admission = safetyStore?.begin();
  let settled = false;
  let receivedHeaders = false;
  const finish = (status: number | "network", riskControl = false) => {
    if (!admission || settled) return;
    settled = true;
    safetyStore?.finish(admission, status, riskControl);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const upstreamRequest = openUpstream(input, upstream => {
        receivedHeaders = true;
        void (async () => {
          const status = upstream.statusCode ?? 502;
          const headerRisk = Boolean(upstream.headers["x-bili-gaia-vvoucher"]);
          if (status === 429 || status >= 500 || headerRisk) finish(status, headerRisk);
          const setCookies = upstream.headers["set-cookie"] ?? [];
          if (session && setCookies.length > 0) await session.updateFromSetCookie(setCookies, input.target);

          if (upstream.headers.location && [301, 302, 303, 307, 308].includes(upstream.statusCode ?? 0)) {
            upstream.resume();
            throw new ProxyRequestError("Bilibili API returned an unsupported redirect", 502);
          }

          if (input.method !== "HEAD" && (transformer?.matches(input.target) || safetyStore)) {
            const body = await readProxyBody(upstream, transformer?.maxBytes ?? 4 * 1024 * 1024);
            if (safetyStore) {
              let payload: unknown;
              try {
                payload = JSON.parse(body.toString("utf8"));
              } catch {
                if (status >= 200 && status < 300) throw new Error("unconfirmed playback response");
              }
              const object =
                payload && typeof payload === "object" && !Array.isArray(payload)
                  ? (payload as { code?: unknown; data?: unknown })
                  : undefined;
              if (
                status >= 200 &&
                status < 300 &&
                (!object || typeof object.code !== "number" || !Number.isSafeInteger(object.code))
              )
                throw new Error("unconfirmed playback response");
              const voucher =
                object?.data && typeof object.data === "object"
                  ? (object.data as { v_voucher?: unknown }).v_voucher
                  : undefined;
              const riskControl =
                object?.code === -352 ||
                object?.code === -412 ||
                (typeof voucher === "string" && voucher.trim().length > 0);
              finish(status, riskControl);
            }
            const transformed = transformer?.matches(input.target)
              ? await transformer.transform(body, {
                  request,
                  response,
                  session,
                  status: upstream.statusCode ?? 502,
                  target: input.target,
                  upstreamHeaders: upstream.headers,
                })
              : body;
            response.statusCode = upstream.statusCode ?? 502;
            copyUpstreamResponseHeaders(response, upstream.headers, true);
            response.setHeader("Cache-Control", "no-store");
            if (input.acceptsGzip) {
              const gzipped = gzipBody(transformed);
              markGzipped(response, gzipped.length);
              response.end(gzipped);
              return;
            }
            response.setHeader("Content-Length", transformed.length);
            response.end(transformed);
            return;
          }

          finish(status, headerRisk);
          await relayUpstreamStream(upstream, response, input);
        })().then(resolve, error => {
          upstream.destroy();
          reject(error);
        });
      });
      upstreamRequest.once("error", reject);
    });
  } catch (error) {
    if (admission && !settled) {
      if (!receivedHeaders || input.signal.aborted) finish("network");
      else {
        safetyStore?.abandon(admission);
        throw new MediaSafetyPausedError("unconfirmed");
      }
    }
    throw error;
  }
}

export function createBilibiliApiProxyHandler(options: BilibiliApiProxyHandlerOptions = {}): BilibiliApiProxyHandler {
  const logger = options.logger ?? console;
  const publicOrigin = normalizePublicOrigin(options.publicOrigin);

  return async (request, response, next) => {
    const match = matchBilibiliApiProxyRequest(request.url ?? "/");
    if (!match) {
      next?.();
      return false;
    }

    const method = request.method ?? "GET";
    const controller = new AbortController();
    const abortUpstream = () => controller.abort();
    const abortOnPrematureClose = () => {
      if (!response.writableEnded) abortUpstream();
    };
    request.once("aborted", abortUpstream);
    response.once("close", abortOnPrematureClose);

    try {
      if (!API_METHODS.has(method)) throw new ProxyRequestError("Bilibili API method is not allowed", 405);
      if (isGenericAuthenticationPath(match.target)) {
        throw new ProxyRequestError("Use the dedicated Web authentication endpoints", 404);
      }
      if (isCrossSiteMutation(request, publicOrigin)) {
        throw new ProxyRequestError("cross-site Bilibili API request rejected", 403);
      }

      const session = await options.sessionProvider?.(request, response);
      const cookieHeader = session?.cookieHeaderFor(match.target) ?? "";
      let body = method === "POST" ? await readProxyBody(request, MAX_API_BODY_BYTES) : Buffer.alloc(0);
      const csrfMode = firstHeader(request.headers["x-biu-csrf"]);
      if (csrfMode === "inject" || csrfMode === "inject-if-present") {
        if (isCrossSiteRequest(request, publicOrigin)) {
          throw new ProxyRequestError("cross-site CSRF injection request rejected", 403);
        }
        const csrf =
          csrfMode === "inject" ? readCsrfFromCookieHeader(cookieHeader) : findCsrfInCookieHeader(cookieHeader);
        if (csrf) {
          if (method === "GET" || method === "HEAD") injectCsrfIntoQuery(match.target, csrf);
          else body = injectCsrfIntoBody(body, firstHeader(request.headers["content-type"]), csrf);
        }
      }

      const input: UpstreamRequestInput = {
        acceptsGzip: acceptsGzip(request),
        body,
        headers: createUpstreamRequestHeaders(request, { body, cookie: cookieHeader }),
        kind: "api",
        mapUpstreamForTest: options.mapUpstreamForTest,
        method,
        signal: controller.signal,
        target: match.target,
      };
      await proxyApiResponse(
        input,
        request,
        response,
        session,
        options.responseTransformer,
        isBilibiliMediaResponse(match.target) ? options.mediaSafetyStore : undefined,
      );
    } catch (error) {
      if (controller.signal.aborted || response.writableEnded) return true;
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return true;
      }
      if (error instanceof MediaSafetyPausedError) {
        sendProxyJson(response, 423, {
          code: "BIU_MEDIA_PAUSED",
          reason: error.reason,
          message: "播放服务已暂停，请联系站点管理员恢复",
        });
        return true;
      }
      if (error instanceof ProxyRequestError) {
        sendProxyJson(response, error.status, { code: -error.status, message: error.message });
        return true;
      }

      logger.error("[web-proxy] Bilibili API request failed", error);
      sendProxyJson(response, 502, { code: -502, message: "Bilibili API request failed" });
    } finally {
      request.off("aborted", abortUpstream);
      response.off("close", abortOnPrematureClose);
    }

    return true;
  };
}
