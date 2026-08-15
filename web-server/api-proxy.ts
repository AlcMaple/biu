import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

import { findCsrfInCookieHeader, injectCsrfIntoBody, injectCsrfIntoQuery, readCsrfFromCookieHeader } from "./csrf.js";
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
) {
  await new Promise<void>((resolve, reject) => {
    const upstreamRequest = openUpstream(input, upstream => {
      void (async () => {
        const setCookies = upstream.headers["set-cookie"] ?? [];
        if (session && setCookies.length > 0) await session.updateFromSetCookie(setCookies, input.target);

        if (upstream.headers.location && [301, 302, 303, 307, 308].includes(upstream.statusCode ?? 0)) {
          upstream.resume();
          throw new ProxyRequestError("Bilibili API returned an unsupported redirect", 502);
        }

        if (input.method !== "HEAD" && transformer?.matches(input.target)) {
          const body = await readProxyBody(upstream, transformer.maxBytes);
          const transformed = await transformer.transform(body, {
            request,
            response,
            session,
            status: upstream.statusCode ?? 502,
            target: input.target,
            upstreamHeaders: upstream.headers,
          });
          response.statusCode = upstream.statusCode ?? 502;
          copyUpstreamResponseHeaders(response, upstream.headers, true);
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Length", transformed.length);
          response.end(transformed);
          return;
        }

        await relayUpstreamStream(upstream, response, input);
      })().then(resolve, reject);
    });
    upstreamRequest.once("error", reject);
  });
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
        body,
        headers: createUpstreamRequestHeaders(request, { body, cookie: cookieHeader }),
        kind: "api",
        mapUpstreamForTest: options.mapUpstreamForTest,
        method,
        signal: controller.signal,
        target: match.target,
      };
      await proxyApiResponse(input, request, response, session, options.responseTransformer);
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

      logger.error("[web-proxy] Bilibili API request failed", error);
      sendProxyJson(response, 502, { code: -502, message: "Bilibili API request failed" });
    } finally {
      request.off("aborted", abortUpstream);
      response.off("close", abortOnPrematureClose);
    }

    return true;
  };
}
