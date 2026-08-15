import type { IncomingMessage, ServerResponse } from "node:http";

import { BILIBILI_WEB_PROXY_ROOT } from "../shared/bilibili-web-proxy.js";
import {
  composeApiResponseTransformers,
  createBilibiliApiProxyHandler,
  type BilibiliApiProxyHandlerOptions,
} from "./api-proxy.js";
import { resolveSession } from "./auth/handler.js";
import { createGaiaApiResponseTransformer } from "./gaia-response.js";
import { createBilibiliMediaProxyHandler, createMediaApiResponseTransformer } from "./media-proxy.js";
import { MediaSessionStore } from "./media-session-store.js";
import { MediaTokenStore } from "./media-token-store.js";
import { sendProxyJson, type ProxyNext } from "./proxy-common.js";

export interface BilibiliProxyHandlerOptions extends Pick<
  BilibiliApiProxyHandlerOptions,
  "logger" | "mapUpstreamForTest" | "publicOrigin" | "sessionProvider"
> {
  mediaSessions?: MediaSessionStore;
  mediaTokens?: MediaTokenStore;
}

export type BilibiliProxyHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: ProxyNext,
) => Promise<boolean>;

export function createBilibiliProxyHandler(options: BilibiliProxyHandlerOptions = {}): BilibiliProxyHandler {
  const mediaSessions = options.mediaSessions ?? new MediaSessionStore();
  const mediaTokens = options.mediaTokens ?? new MediaTokenStore();
  const runtime = { mediaSessions, mediaTokens };
  const mediaHandler = createBilibiliMediaProxyHandler({
    ...runtime,
    logger: options.logger,
    mapUpstreamForTest: options.mapUpstreamForTest,
  });
  const apiHandler = createBilibiliApiProxyHandler({
    logger: options.logger,
    mapUpstreamForTest: options.mapUpstreamForTest,
    publicOrigin: options.publicOrigin,
    responseTransformer: composeApiResponseTransformers(
      createMediaApiResponseTransformer(runtime),
      createGaiaApiResponseTransformer(),
    ),
    sessionProvider: options.sessionProvider ?? (async (request, response) => resolveSession(request, response)),
  });

  return async (request, response, next) => {
    if (await mediaHandler(request, response)) return true;
    if (await apiHandler(request, response)) return true;

    const pathname = new URL(request.url ?? "/", "http://biu.local").pathname;
    if (pathname === BILIBILI_WEB_PROXY_ROOT || pathname.startsWith(`${BILIBILI_WEB_PROXY_ROOT}/`)) {
      sendProxyJson(response, 404, { code: -404, message: "Bilibili proxy endpoint not found" });
      return true;
    }

    next?.();
    return false;
  };
}
