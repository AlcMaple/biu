import type { IncomingMessage, ServerResponse } from "node:http";

import * as Sentry from "@sentry/node";
import { randomUUID } from "node:crypto";

import { sanitizeBiuMonitoringUser, type BiuMonitoringUser } from "../shared/monitoring-user.js";
import { WEB_CLIENT_LOG_PATH } from "../shared/web-client-log.js";

const DEFAULT_TRACES_SAMPLE_RATE = 0.05;
const TRACEABLE_PATH = /^\/__biu_/;
const requestIds = new WeakMap<IncomingMessage, string>();
const requestUsers = new WeakMap<IncomingMessage, BiuMonitoringUser>();
const dsn = process.env.SENTRY_DSN?.trim();

function sampleRate(raw: string | undefined) {
  if (!raw?.trim()) return DEFAULT_TRACES_SAMPLE_RATE;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_TRACES_SAMPLE_RATE;
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanUrl(raw: string | undefined) {
  if (!raw) return raw;
  try {
    const url = new URL(raw, "http://biu.local");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return raw.split(/[?#]/, 1)[0];
  }
}

type MonitoringRequest = {
  url?: string;
  headers?: unknown;
  cookies?: unknown;
  data?: unknown;
  query_string?: unknown;
  env?: unknown;
};

export function redactSentryRequest(request: MonitoringRequest | undefined) {
  if (!request) return;

  request.url = cleanUrl(request.url);
  const headers = request.headers;
  const record = headers && typeof headers === "object" ? (headers as Record<string, unknown>) : undefined;
  const userAgent = record?.["User-Agent"] ?? record?.["user-agent"];
  request.headers = typeof userAgent === "string" ? { "User-Agent": userAgent } : undefined;
  request.cookies = undefined;
  request.data = undefined;
  request.query_string = undefined;
  request.env = undefined;
}

function redactSpanUrls(spans: unknown) {
  if (!Array.isArray(spans)) return;

  for (const rawSpan of spans) {
    if (!rawSpan || typeof rawSpan !== "object") continue;
    const span = rawSpan as { description?: string; data?: Record<string, unknown> };
    if (span.description) {
      const match = /^([A-Z]+)\s+(.+)$/.exec(span.description);
      if (match) span.description = `${match[1]} ${cleanUrl(match[2]) ?? match[2]}`;
    }
    if (!span.data) continue;

    for (const [key, value] of Object.entries(span.data)) {
      if (/query|cookie|authorization|request\.body|response\.body/i.test(key)) {
        delete span.data[key];
      } else if (/url/i.test(key) && typeof value === "string") {
        span.data[key] = cleanUrl(value);
      }
    }
  }
}

export let isWebMonitoringEnabled = false;

export function setWebRequestUser(request: IncomingMessage, user: BiuMonitoringUser | null | undefined) {
  if (!user) {
    requestUsers.delete(request);
    if (isWebMonitoringEnabled) Sentry.getCurrentScope().setUser(null);
    return;
  }

  const safeUser = sanitizeBiuMonitoringUser(user);
  if (!safeUser) {
    requestUsers.delete(request);
    if (isWebMonitoringEnabled) Sentry.getCurrentScope().setUser(null);
    return;
  }

  requestUsers.set(request, safeUser);
  if (isWebMonitoringEnabled) Sentry.getCurrentScope().setUser(safeUser);
}

if (dsn) {
  try {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      release: process.env.SENTRY_RELEASE || undefined,
      sendDefaultPii: false,
      includeLocalVariables: false,
      registerEsmLoaderHooks: false,
      integrations: integrations => integrations.filter(integration => integration.name !== "Http"),
      tracesSampleRate: sampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
      beforeSend(event) {
        event.user = sanitizeBiuMonitoringUser(event.user);
        redactSentryRequest(event.request);
        return event;
      },
      beforeSendTransaction(event) {
        event.user = sanitizeBiuMonitoringUser(event.user);
        redactSentryRequest(event.request);
        redactSpanUrls(event.spans);
        if (event.transaction) event.transaction = cleanUrl(event.transaction) ?? event.transaction;
        return event;
      },
    });
    isWebMonitoringEnabled = true;
  } catch (error) {
    console.error("[web] Sentry initialization failed", error);
  }
}

export function requestPath(request: IncomingMessage) {
  try {
    return new URL(request.url ?? "/", "http://biu.local").pathname;
  } catch {
    return "/";
  }
}

export function stablePath(pathname: string) {
  return pathname
    .replace(/\/[0-9]+(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:id")
    .replace(/\/[A-Za-z0-9_-]{32,}(?=\/|$)/g, "/:token");
}

export function isTraceableWebPath(pathname: string) {
  return TRACEABLE_PATH.test(pathname) && pathname !== "/__biu_health" && pathname !== WEB_CLIENT_LOG_PATH;
}

export function ensureWebRequestId(request: IncomingMessage, response: ServerResponse) {
  const requestId = requestIds.get(request) ?? randomUUID();
  requestIds.set(request, requestId);
  response.setHeader("X-Request-ID", requestId);
  return requestId;
}

export function withWebRequestMonitoring(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  handler: () => Promise<void>,
) {
  const path = stablePath(requestPath(request));
  if (!isWebMonitoringEnabled || !isTraceableWebPath(path)) return handler();

  const method = request.method ?? "GET";
  const user = requestUsers.get(request);
  return Sentry.withIsolationScope(scope => {
    if (user) scope.setUser(user);
    scope.setTag("request_id", requestId);
    scope.setTag("http.method", method);
    scope.setContext("request", { id: requestId, method, path });

    return Sentry.continueTrace(
      {
        sentryTrace: firstHeader(request.headers["sentry-trace"]),
        baggage: firstHeader(request.headers.baggage),
      },
      () =>
        Sentry.startSpan(
          {
            name: `${method} ${path}`,
            op: "http.server",
            attributes: {
              "http.request.method": method,
              "url.path": path,
              "biu.request_id": requestId,
            },
          },
          async span => {
            try {
              await handler();
            } finally {
              const status = response.statusCode || 500;
              span.setAttribute("http.response.status_code", status);
              span.setStatus(Sentry.getSpanStatusFromHttpCode(status));
            }
          },
        ),
    );
  });
}

export async function captureWebRequestError(error: unknown, request: IncomingMessage, requestId: string) {
  const method = request.method ?? "GET";
  const path = stablePath(requestPath(request));
  console.error(`[web] request failed id=${requestId} ${method} ${path}`, error);

  if (!isWebMonitoringEnabled) return;
  Sentry.withIsolationScope(scope => {
    const user = requestUsers.get(request);
    if (user) scope.setUser(user);
    scope.setTag("request_id", requestId);
    scope.setTag("http.method", method);
    scope.setContext("request", { id: requestId, method, path });
    Sentry.captureException(error);
  });
  await Sentry.flush(1500);
}

export async function captureWebStartupError(error: unknown) {
  if (!isWebMonitoringEnabled) return;
  Sentry.captureException(error);
  await Sentry.flush(1500);
}
