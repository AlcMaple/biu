import type { IncomingMessage, ServerResponse } from "node:http";

import { isIP } from "node:net";

import {
  BilibiliAuthClient,
  BilibiliUpstreamError,
  parseBilibiliSetCookie,
  type BilibiliUser,
} from "./bilibili-auth.js";
import {
  DEFAULT_PENDING_LOGIN_TTL_MS,
  PendingLoginCapacityError,
  PendingLoginStore,
  WEB_LOGIN_COOKIE_NAME,
  serializeClearedWebLoginCookie,
  serializeWebLoginCookie,
} from "./pending-login-store.js";
import { QrRateLimiter, type QrRateLimitAction } from "./rate-limit.js";
import { WEB_SESSION_REFRESH_CHECK_INTERVAL_MS, WebSessionRefreshCoordinator } from "./session-refresh.js";
import {
  WebSessionStore,
  formatBilibiliCookieHeader,
  hasWebSessionCookie,
  parseCookieHeader,
  serializeClearedWebSessionCookie,
  type WebSessionRecord,
} from "./session-store.js";

export const WEB_AUTH_ROOT = "/__biu_auth";

const BODY_LIMIT_BYTES = 16 * 1024;
export const defaultWebSessionStore = new WebSessionStore();
const defaultWebAuthClient = new BilibiliAuthClient();
export const defaultWebSessionRefreshCoordinator = new WebSessionRefreshCoordinator({
  authClient: defaultWebAuthClient,
  sessionStore: defaultWebSessionStore,
});
const defaultPendingLoginStore = new PendingLoginStore();

interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

interface RequestWithOptionalBody extends IncomingMessage {
  body?: unknown;
}

export interface WebAuthHandlerOptions {
  authClient?: BilibiliAuthClient;
  clientIpHeader?: string;
  logger?: Logger;
  now?: () => number;
  pendingLoginStore?: PendingLoginStore;
  publicOrigin?: string;
  qrRateLimiter?: QrRateLimiter;
  refreshCheckIntervalMs?: number;
  refreshCoordinator?: WebSessionRefreshCoordinator;
  sessionStore?: WebSessionStore;
}

export type WebAuthNext = (error?: unknown) => void;
export type WebAuthHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: WebAuthNext,
) => Promise<boolean>;

export interface ResolvedWebSession {
  cookieHeaderFor: (target: string | URL) => string;
  sessionId: string;
  updateFromSetCookie: (setCookies: string[], responseUrl: string | URL) => void;
}

export type WebSessionResolver = (
  request: IncomingMessage,
  response?: ServerResponse,
) => Promise<ResolvedWebSession | undefined>;

class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(body);
}

function appendSetCookie(response: ServerResponse, cookie: string): void {
  const existing = response.getHeader("Set-Cookie");
  if (Array.isArray(existing)) response.setHeader("Set-Cookie", [...existing.map(String), cookie]);
  else if (existing !== undefined) response.setHeader("Set-Cookie", [String(existing), cookie]);
  else response.setHeader("Set-Cookie", cookie);
}

function browserLoginToken(request: IncomingMessage): string | undefined {
  const rawCookie = Array.isArray(request.headers.cookie) ? request.headers.cookie.join("; ") : request.headers.cookie;
  return parseCookieHeader(rawCookie ?? "").get(WEB_LOGIN_COOKIE_NAME);
}

function normalizePublicOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("BIU_WEB_PUBLIC_ORIGIN must be an HTTP(S) origin without path, credentials, query, or hash");
  }
  return url.origin;
}

function inferredRequestOrigin(request: IncomingMessage): string | undefined {
  const host = request.headers.host;
  if (!host) return undefined;

  const encrypted = Boolean(
    (request.socket as (typeof request.socket & { encrypted?: boolean }) | undefined)?.encrypted,
  );
  try {
    return new URL(`${encrypted ? "https" : "http"}://${host}`).origin;
  } catch {
    return undefined;
  }
}

function normalizedRequestHost(request: IncomingMessage, protocol = "http:"): string | undefined {
  const host = request.headers.host;
  if (!host) return undefined;
  try {
    return new URL(`${protocol}//${host}`).host;
  } catch {
    return undefined;
  }
}

function rejectCrossSiteRequest(
  request: IncomingMessage,
  response: ServerResponse,
  configuredPublicOrigin?: string,
): boolean {
  const origin = request.headers.origin;
  // Forwarded host/proto can be supplied by a client unless every deployment proxy strips them.
  // A TLS-terminating proxy must configure BIU_WEB_PUBLIC_ORIGIN explicitly.
  const expectedOrigin = configuredPublicOrigin ?? inferredRequestOrigin(request);

  let rejected = request.headers["sec-fetch-site"] === "cross-site";
  if (configuredPublicOrigin) {
    const configuredUrl = new URL(configuredPublicOrigin);
    rejected ||= normalizedRequestHost(request, configuredUrl.protocol) !== configuredUrl.host;
  }
  if (origin) {
    try {
      rejected ||= !expectedOrigin || new URL(origin).origin !== expectedOrigin;
    } catch {
      rejected = true;
    }
  }

  if (!rejected) return false;
  sendJson(response, 403, { code: -403, message: "cross-site authentication request rejected" });
  return true;
}

function normalizeClientIpHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const header = value.trim().toLowerCase();
  if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(header)) {
    throw new Error("BIU_WEB_CLIENT_IP_HEADER must be one valid HTTP header name");
  }
  return header;
}

function configuredClientAddress(request: IncomingMessage, clientIpHeader: string | undefined): string | undefined {
  if (!clientIpHeader) return undefined;

  const raw = request.headers[clientIpHeader];
  if (!raw || Array.isArray(raw)) return undefined;
  const candidate = raw.trim();
  return isIP(candidate) ? candidate : undefined;
}

async function readJsonBody(request: RequestWithOptionalBody): Promise<Record<string, unknown>> {
  if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
    return request.body as Record<string, unknown>;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > BODY_LIMIT_BYTES) throw new RequestBodyError("request body is too large", 413);
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new RequestBodyError("request body must be a JSON object", 400);
  }
}

function mapUpstreamStatus(error: BilibiliUpstreamError): number {
  if (error.status === 401 || error.status === 409) return error.status;
  return 502;
}

function unauthenticatedPayload() {
  return { code: -101, data: { isLogin: false }, message: "账号未登录" };
}

function sessionPayload(user: BilibiliUser) {
  return { code: 0, data: { isLogin: true, user }, message: "0" };
}

export async function resolveCookie(request: IncomingMessage, target: string | URL): Promise<string | undefined> {
  const resolved = await resolveSession(request);
  return resolved?.cookieHeaderFor(target) || undefined;
}

export function createWebSessionResolver(
  sessionStore = defaultWebSessionStore,
  refreshCoordinator?: WebSessionRefreshCoordinator,
  logger: Logger = console,
): WebSessionResolver {
  const observedBackgroundRefreshes = new Set<Promise<unknown>>();

  return async (request, response) => {
    const resolved = sessionStore.resolveSessionRecord(request);
    if (!resolved) {
      if (response && hasWebSessionCookie(request)) appendSetCookie(response, serializeClearedWebSessionCookie());
      return undefined;
    }

    if (refreshCoordinator) {
      const refresh = refreshCoordinator.refreshIfDue(resolved);
      if (!observedBackgroundRefreshes.has(refresh)) {
        observedBackgroundRefreshes.add(refresh);
        void refresh
          .catch(error => {
            logger.warn("[web-auth] background Cookie refresh failed", error);
          })
          .finally(() => {
            observedBackgroundRefreshes.delete(refresh);
          });
      }
    }

    return {
      cookieHeaderFor: target => formatBilibiliCookieHeader(resolved.session.cookies.values(), target),
      sessionId: resolved.sessionId,
      updateFromSetCookie: (setCookies, responseUrl) => {
        const updates = setCookies
          .map(header => parseBilibiliSetCookie(header, responseUrl))
          .filter(cookie => cookie !== undefined);
        sessionStore.updateSessionById(resolved.sessionId, { cookies: updates });
      },
    };
  };
}

export const resolveSession = createWebSessionResolver(defaultWebSessionStore, defaultWebSessionRefreshCoordinator);

export function createWebAuthHandler(options: WebAuthHandlerOptions = {}): WebAuthHandler {
  const authClient = options.authClient ?? defaultWebAuthClient;
  const clientIpHeader = normalizeClientIpHeader(options.clientIpHeader ?? process.env.BIU_WEB_CLIENT_IP_HEADER);
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;
  const pendingLogins = options.pendingLoginStore ?? defaultPendingLoginStore;
  const publicOrigin = normalizePublicOrigin(options.publicOrigin ?? process.env.BIU_WEB_PUBLIC_ORIGIN);
  const qrRateLimiter = options.qrRateLimiter ?? new QrRateLimiter({ now });
  const sessions = options.sessionStore ?? defaultWebSessionStore;
  const refreshCoordinator =
    options.refreshCoordinator ??
    (authClient === defaultWebAuthClient && sessions === defaultWebSessionStore && options.now === undefined
      ? defaultWebSessionRefreshCoordinator
      : new WebSessionRefreshCoordinator({
          authClient,
          checkIntervalMs: options.refreshCheckIntervalMs ?? WEB_SESSION_REFRESH_CHECK_INTERVAL_MS,
          now,
          sessionStore: sessions,
        }));

  const rejectRateLimitedQrRequest = (
    action: QrRateLimitAction,
    request: IncomingMessage,
    response: ServerResponse,
  ): boolean => {
    const result = qrRateLimiter.consume(action, configuredClientAddress(request, clientIpHeader));
    if (result.allowed) return false;

    if (result.retryAfterSeconds) response.setHeader("Retry-After", result.retryAfterSeconds);
    sendJson(response, 429, { code: -429, message: "二维码登录请求过于频繁，请稍后重试" });
    return true;
  };

  const handleCreateQr = async (request: IncomingMessage, response: ServerResponse) => {
    pendingLogins.clearBrowser(browserLoginToken(request));
    response.setHeader("Set-Cookie", serializeClearedWebLoginCookie());

    const qr = await authClient.createQrCode();
    const pending = pendingLogins.create(qr.authCode);
    response.setHeader(
      "Set-Cookie",
      serializeWebLoginCookie(pending.browserToken, DEFAULT_PENDING_LOGIN_TTL_MS / 1000),
    );
    sendJson(response, 200, {
      code: 0,
      data: { expiresAt: pending.expiresAt, loginId: pending.loginId, url: qr.url },
      message: "0",
    });
  };

  const handlePollQr = async (request: RequestWithOptionalBody, response: ServerResponse) => {
    const body = await readJsonBody(request);
    const loginId = typeof body.loginId === "string" ? body.loginId : "";
    const claim = pendingLogins.claim(loginId, browserLoginToken(request));

    if (claim.status === "missing" || claim.status === "expired") {
      response.setHeader("Set-Cookie", serializeClearedWebLoginCookie());
      sendJson(response, 200, { code: 86038, data: null, message: "二维码已失效" });
      return;
    }
    if (claim.status === "binding-mismatch") {
      sendJson(response, 200, { code: 86038, data: null, message: "二维码不属于当前浏览器" });
      return;
    }
    if (claim.status === "busy") {
      sendJson(response, 200, { code: 86039, data: null, message: "二维码状态查询仍在进行" });
      return;
    }

    let consume = false;
    let loginCookieCleared = false;
    const clearLoginCookie = () => {
      appendSetCookie(response, serializeClearedWebLoginCookie());
      loginCookieCleared = true;
    };
    try {
      const poll = await authClient.pollQrCode(claim.pending.authCode);
      if (poll.code !== 0) {
        // 只有“未扫码/已扫码待确认”允许继续轮询；限流、风控、过期及未知状态都终止事务，
        // 避免 renderer 对致命响应持续轰炸 B 站。
        consume = poll.code !== 86039 && poll.code !== 86090;
        if (consume) clearLoginCookie();
        sendJson(response, 200, { code: poll.code, data: null, message: poll.message });
        return;
      }

      // 上游已把二维码兑换为凭证，事务无论后续校验成功与否都不可再次使用。
      consume = true;

      const requiredCookieNames = ["SESSDATA", "bili_jct"];
      if (
        requiredCookieNames.some(name => !poll.cookies.some(cookie => cookie.name === name && cookie.value)) ||
        !poll.refreshToken
      ) {
        throw new BilibiliUpstreamError("Bilibili login succeeded without complete refreshable credentials");
      }

      const user = await authClient.getUser(poll.cookies);
      if (poll.mid && user.mid !== poll.mid) {
        throw new BilibiliUpstreamError("Bilibili login identity validation failed");
      }

      // Replace an existing browser session only after the new Bilibili identity is fully validated.
      sessions.destroySession(request);
      const issued = sessions.createSession({ cookies: poll.cookies, refreshToken: poll.refreshToken });
      response.setHeader("Set-Cookie", issued.cookieHeader);
      clearLoginCookie();
      sendJson(response, 200, { code: 0, data: { user }, message: "0" });
    } finally {
      pendingLogins.release(loginId, consume);
      if (consume && !loginCookieCleared) clearLoginCookie();
    }
  };

  const getAuthenticatedSession = (
    request: IncomingMessage,
    response: ServerResponse,
  ): { session: WebSessionRecord; sessionId: string } | undefined => {
    const resolved = sessions.resolveSessionRecord(request);
    if (!resolved) {
      if (hasWebSessionCookie(request)) appendSetCookie(response, serializeClearedWebSessionCookie());
      sendJson(response, 401, unauthenticatedPayload());
    }
    return resolved;
  };

  const handleGetSession = async (request: IncomingMessage, response: ServerResponse) => {
    const session = sessions.getSession(request);
    if (!session) {
      if (hasWebSessionCookie(request)) appendSetCookie(response, serializeClearedWebSessionCookie());
      sendJson(response, 200, unauthenticatedPayload());
      return;
    }

    try {
      const user = await authClient.getUser(session.cookies.values());
      sendJson(response, 200, sessionPayload(user));
    } catch (error) {
      if (error instanceof BilibiliUpstreamError && error.status === 401) {
        sessions.destroySession(request);
        response.setHeader("Set-Cookie", serializeClearedWebSessionCookie());
        sendJson(response, 200, unauthenticatedPayload());
        return;
      }
      throw error;
    }
  };

  const handleRefresh = async (request: IncomingMessage, response: ServerResponse) => {
    const resolved = getAuthenticatedSession(request, response);
    if (!resolved) return;

    try {
      const result = await refreshCoordinator.refreshNow(resolved);
      const user = await authClient.getUser(resolved.session.cookies.values());
      sendJson(response, 200, { code: 0, data: { refreshed: result.refreshed, user }, message: "0" });
    } catch (error) {
      if (error instanceof BilibiliUpstreamError && error.status === 401) {
        sessions.destroySession(request);
        response.setHeader("Set-Cookie", serializeClearedWebSessionCookie());
      }
      throw error;
    }
  };

  const handleLogout = async (request: IncomingMessage, response: ServerResponse) => {
    const session = sessions.getSession(request);
    let upstreamLoggedOut = false;

    if (session) {
      try {
        upstreamLoggedOut = await authClient.logout(session);
      } catch (error) {
        logger.warn("[web-auth] Bilibili logout failed; local session was still destroyed", error);
      }
    }

    sessions.destroySession(request);
    response.setHeader("Set-Cookie", serializeClearedWebSessionCookie());
    sendJson(response, 200, { code: 0, data: { upstreamLoggedOut }, message: "0" });
  };

  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(`${WEB_AUTH_ROOT}/`) && url.pathname !== WEB_AUTH_ROOT) {
      next?.();
      return false;
    }

    try {
      const route = `${request.method ?? "GET"} ${url.pathname}`;
      if (request.method !== "GET" && rejectCrossSiteRequest(request, response, publicOrigin)) return true;

      if (route === `POST ${WEB_AUTH_ROOT}/qrcode` && rejectRateLimitedQrRequest("create", request, response)) {
        return true;
      }
      if (route === `POST ${WEB_AUTH_ROOT}/qrcode/poll` && rejectRateLimitedQrRequest("poll", request, response)) {
        return true;
      }

      switch (route) {
        case `POST ${WEB_AUTH_ROOT}/qrcode`:
          await handleCreateQr(request, response);
          break;
        case `POST ${WEB_AUTH_ROOT}/qrcode/poll`:
          await handlePollQr(request, response);
          break;
        case `GET ${WEB_AUTH_ROOT}/session`:
          await handleGetSession(request, response);
          break;
        case `POST ${WEB_AUTH_ROOT}/session/refresh`:
          await handleRefresh(request, response);
          break;
        case `POST ${WEB_AUTH_ROOT}/logout`:
          await handleLogout(request, response);
          break;
        default:
          sendJson(response, 404, { code: -404, message: "Web authentication endpoint not found" });
          break;
      }
    } catch (error) {
      if (response.writableEnded) return true;

      if (error instanceof RequestBodyError) {
        sendJson(response, error.status, { code: -400, message: error.message });
        return true;
      }

      if (error instanceof PendingLoginCapacityError) {
        response.setHeader("Retry-After", Math.ceil(3 * 60));
        sendJson(response, 429, { code: -429, message: "二维码登录队列已满，请稍后重试" });
        return true;
      }

      if (error instanceof BilibiliUpstreamError) {
        logger.warn("[web-auth] Bilibili authentication request failed", error);
        sendJson(response, mapUpstreamStatus(error), { code: -502, message: error.message });
        return true;
      }

      logger.error("[web-auth] unexpected request failure", error);
      sendJson(response, 500, { code: -500, message: "Web authentication service failed" });
    }

    return true;
  };
}
