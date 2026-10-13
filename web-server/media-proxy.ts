import type { IncomingMessage, ServerResponse } from "node:http";

import type { ApiResponseTransformer } from "./api-proxy.js";

import { BILIBILI_MEDIA_PROXY_PREFIX } from "../shared/bilibili-web-proxy.js";
import { resolveMediaRate } from "./media-pacer.js";
import { isBilibiliMediaResponse, rewriteBilibiliMediaPayload } from "./media-response.js";
import { MediaSessionStore } from "./media-session-store.js";
import { MediaTokenStore } from "./media-token-store.js";
import {
  ProxyRequestError,
  createUpstreamRequestHeaders,
  requestAndRelayStream,
  sendProxyJson,
  type ProxyLogger,
  type ProxyNext,
  type UpstreamMapper,
  type UpstreamRequestInput,
} from "./proxy-common.js";
import { isAllowedBilibiliMediaUrl, matchBilibiliMediaProxyToken } from "./routes.js";

const MEDIA_METHODS = new Set(["GET", "HEAD"]);
const MAX_MEDIA_JSON_BYTES = 4 * 1024 * 1024;
const MAX_MEDIA_REDIRECTS = 3;
// 3 Mbps 部署机的约 40%；单条流再快也只是让浏览器多囤缓冲，换来的是接口被挤超时
const DEFAULT_MAX_MEDIA_RATE_BYTES = 160 * 1024;

export interface MediaProxyRuntime {
  mediaSessions: MediaSessionStore;
  mediaTokens: MediaTokenStore;
}

export interface BilibiliMediaProxyHandlerOptions extends MediaProxyRuntime {
  logger?: ProxyLogger;
  /** 单条媒体流的速率上限（字节/秒）；0 关闭限速 */
  maxMediaRateBytes?: number;
  mapUpstreamForTest?: UpstreamMapper;
}

export type BilibiliMediaProxyHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: ProxyNext,
) => Promise<boolean>;

export function createMediaApiResponseTransformer(runtime: MediaProxyRuntime): ApiResponseTransformer {
  return {
    matches: isBilibiliMediaResponse,
    maxBytes: MAX_MEDIA_JSON_BYTES,
    transform(body, { request, response }) {
      let payload: unknown;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        throw new ProxyRequestError("Bilibili play URL response was not valid JSON", 502);
      }

      let mediaSessionId: string | undefined;
      const rewritten = rewriteBilibiliMediaPayload(payload, (target, bandwidth) => {
        mediaSessionId ??= runtime.mediaSessions.resolveOrCreate(request, response);
        return runtime.mediaTokens.register(target, mediaSessionId, bandwidth);
      });
      return Buffer.from(JSON.stringify(rewritten.payload));
    },
  };
}

export function createBilibiliMediaProxyHandler(options: BilibiliMediaProxyHandlerOptions): BilibiliMediaProxyHandler {
  const logger = options.logger ?? console;
  const maxMediaRate = options.maxMediaRateBytes ?? DEFAULT_MAX_MEDIA_RATE_BYTES;

  return async (request, response, next) => {
    const requestUrl = new URL(request.url ?? "/", "http://biu.local");
    const isMediaRoute =
      requestUrl.pathname === BILIBILI_MEDIA_PROXY_PREFIX ||
      requestUrl.pathname.startsWith(`${BILIBILI_MEDIA_PROXY_PREFIX}/`);
    if (!isMediaRoute) {
      next?.();
      return false;
    }

    const controller = new AbortController();
    const abortUpstream = () => controller.abort();
    const abortOnPrematureClose = () => {
      if (!response.writableEnded) abortUpstream();
    };
    request.once("aborted", abortUpstream);
    response.once("close", abortOnPrematureClose);

    try {
      const method = request.method ?? "GET";
      if (!MEDIA_METHODS.has(method)) throw new ProxyRequestError("Bilibili media method is not allowed", 405);

      const token = matchBilibiliMediaProxyToken(request.url ?? "/");
      const mediaSessionId = options.mediaSessions.resolve(request);
      if (!token || !mediaSessionId) throw new ProxyRequestError("Bilibili media token was not found", 404);

      const record = options.mediaTokens.resolveRecord(token, mediaSessionId);
      if (!record) throw new ProxyRequestError("Bilibili media token was not found", 404);

      const input: UpstreamRequestInput = {
        body: Buffer.alloc(0),
        headers: createUpstreamRequestHeaders(request, { body: Buffer.alloc(0), includeRange: true }),
        kind: "media",
        mapUpstreamForTest: options.mapUpstreamForTest,
        method,
        mediaRateBytes: maxMediaRate > 0 ? resolveMediaRate(record.bandwidth, maxMediaRate) : undefined,
        signal: controller.signal,
        target: record.target,
      };
      await requestAndRelayStream(input, response, {
        redirectsLeft: MAX_MEDIA_REDIRECTS,
        validateRedirect: isAllowedBilibiliMediaUrl,
      });
    } catch (error) {
      if (controller.signal.aborted || response.writableEnded) return true;
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return true;
      }
      if (error instanceof ProxyRequestError) {
        sendProxyJson(response, error.status, { code: -error.status, message: error.message });
        return true;
      }

      logger.error("[web-proxy] Bilibili media request failed", error);
      sendProxyJson(response, 502, { code: -502, message: "Bilibili media request failed" });
    } finally {
      request.off("aborted", abortUpstream);
      response.off("close", abortOnPrematureClose);
    }

    return true;
  };
}
