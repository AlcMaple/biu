import type { IncomingMessage, ServerResponse } from "node:http";

import { createAcmeChallengeProxyHandler, type AcmeChallengeProxyHandler } from "./acme-challenge-proxy.js";
import { createWebAuthHandler, type WebAuthHandler } from "./auth/handler.js";
import { sendProxyJson, type ProxyNext } from "./proxy-common.js";
import { createBilibiliProxyHandler, type BilibiliProxyHandler } from "./proxy.js";
import { createBiuSyncProxyHandler, type BiuSyncProxyHandler } from "./sync-proxy.js";

export const WEB_HEALTH_PATH = "/__biu_health";

export interface WebApplicationHandlerOptions {
  acmeChallengeHandler?: AcmeChallengeProxyHandler;
  authHandler?: WebAuthHandler;
  clientIpHeader?: string;
  proxyHandler?: BilibiliProxyHandler;
  publicOrigin?: string;
  syncProxyHandler?: BiuSyncProxyHandler;
}

export type WebApplicationHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: ProxyNext,
) => Promise<boolean>;

export function createWebApplicationHandler(options: WebApplicationHandlerOptions = {}): WebApplicationHandler {
  const publicOrigin = options.publicOrigin ?? process.env.BIU_WEB_PUBLIC_ORIGIN;
  const acmeChallengeHandler = options.acmeChallengeHandler ?? createAcmeChallengeProxyHandler();
  const authHandler =
    options.authHandler ?? createWebAuthHandler({ clientIpHeader: options.clientIpHeader, publicOrigin });
  const proxyHandler = options.proxyHandler ?? createBilibiliProxyHandler({ publicOrigin });
  const syncProxyHandler = options.syncProxyHandler ?? createBiuSyncProxyHandler({ publicOrigin });

  return async (request, response, next) => {
    response.setHeader("Referrer-Policy", "no-referrer");

    const url = new URL(request.url ?? "/", "http://biu.local");
    if (url.pathname === WEB_HEALTH_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        sendProxyJson(response, 405, { code: -405, message: "health check method is not allowed" });
        return true;
      }
      sendProxyJson(response, 200, { code: 0, status: "ok" });
      return true;
    }

    if (await acmeChallengeHandler(request, response)) return true;
    if (await authHandler(request, response)) return true;
    if (await syncProxyHandler(request, response)) return true;
    if (await proxyHandler(request, response)) return true;

    next?.();
    return false;
  };
}
