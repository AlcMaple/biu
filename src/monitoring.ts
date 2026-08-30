import * as Sentry from "@sentry/react";

import { sanitizeBiuMonitoringUser, type BiuMonitoringUser } from "@shared/monitoring-user";

const DEFAULT_TRACES_SAMPLE_RATE = 0.05;
const TRACEABLE_PATH = /^\/__biu_/;
const SENTRY_LEVELS = ["debug", "info", "log", "warning", "error", "fatal"] as const;

type MonitoringRequest = {
  url?: string;
  headers?: unknown;
  cookies?: unknown;
  data?: unknown;
  query_string?: unknown;
  env?: unknown;
};

function sampleRate(raw: string | undefined) {
  if (!raw?.trim()) return DEFAULT_TRACES_SAMPLE_RATE;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_TRACES_SAMPLE_RATE;
}

function cleanUrl(raw: string | undefined) {
  if (!raw) return raw;
  try {
    const base = typeof window === "undefined" ? "http://biu.local" : window.location.origin;
    const url = new URL(raw, base);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return raw.split(/[?#]/, 1)[0];
  }
}

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

function captureException(error: unknown, componentStack?: string) {
  Sentry.withScope(scope => {
    if (componentStack) scope.setContext("react", { componentStack });
    Sentry.captureException(error);
  });
}

export function initBrowserMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE?.trim() || undefined,
    sendDefaultPii: false,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: sampleRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE),
    tracePropagationTargets: [TRACEABLE_PATH, /^https:\/\/[^/]*\balcmaple\.cn\/__biu_/],
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data?.url && typeof breadcrumb.data.url === "string") {
        breadcrumb.data.url = cleanUrl(breadcrumb.data.url);
      }
      if (breadcrumb.category === "fetch" || breadcrumb.category === "xhr") {
        delete breadcrumb.data?.request_body;
        delete breadcrumb.data?.response_body;
      }
      return breadcrumb;
    },
    beforeSend(event) {
      event.user = sanitizeBiuMonitoringUser(event.user);
      redactSentryRequest(event.request);
      return event;
    },
    beforeSendTransaction(event) {
      event.user = sanitizeBiuMonitoringUser(event.user);
      redactSentryRequest(event.request);
      redactSpanUrls(event.spans);
      if (event.transaction) event.transaction = event.transaction.split(/[?#]/, 1)[0];
      return event;
    },
  });

  window.__biuMonitoring = {
    captureException,
    setUser(user: BiuMonitoringUser | null) {
      Sentry.setUser(user ? (sanitizeBiuMonitoringUser(user) ?? null) : null);
    },
    captureMessage(message, level = "error") {
      if (SENTRY_LEVELS.includes(level)) Sentry.captureMessage(message, level);
    },
  };
  return true;
}

export function captureRecoverableReactError(error: unknown, componentStack?: string) {
  captureException(error, componentStack);
}
