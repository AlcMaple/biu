// @vitest-environment node

import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { sanitizeBiuMonitoringUser, toBiuMonitoringUser } from "../shared/monitoring-user";
import { redactSentryRequest as redactBrowserSentryRequest } from "../src/monitoring";
import {
  ensureWebRequestId,
  isTraceableWebPath,
  redactSentryRequest,
  stablePath,
  withWebRequestMonitoring,
} from "../web-server/monitoring";

describe("Web Sentry privacy boundaries", () => {
  it("associates only the Bilibili mid and bounded nickname", () => {
    expect(toBiuMonitoringUser({ mid: 42, uname: " Biu " })).toEqual({ id: "42", username: "Biu" });
    expect(toBiuMonitoringUser({ mid: 0, uname: "Biu" })).toBeNull();
    expect(
      sanitizeBiuMonitoringUser({ id: "42", username: "Biu", email: "private@example.com", ip_address: "127.0.0.1" }),
    ).toEqual({ id: "42", username: "Biu" });
  });

  it("removes URL queries and keeps only User-Agent headers", () => {
    const request = {
      url: "https://music.alcmaple.cn/__biu_auth/session?cookie=secret#fragment",
      headers: { cookie: "secret", authorization: "bearer secret", "user-agent": "test browser" },
      cookies: { SESSDATA: "secret" },
      data: { phone: "13800000000" },
      query_string: { token: "secret" },
      env: { secret: "secret" },
    };

    redactSentryRequest(request);
    expect(request).toEqual({
      url: "https://music.alcmaple.cn/__biu_auth/session",
      headers: { "User-Agent": "test browser" },
      cookies: undefined,
      data: undefined,
      query_string: undefined,
      env: undefined,
    });

    const browserRequest = {
      url: "https://music.alcmaple.cn/__biu_auth/session?cookie=secret#fragment",
      headers: { Cookie: "secret", "User-Agent": "test browser" },
      data: { phone: "13800000000" },
    };
    redactBrowserSentryRequest(browserRequest);
    expect(browserRequest).toMatchObject({
      url: "https://music.alcmaple.cn/__biu_auth/session",
      headers: { "User-Agent": "test browser" },
      data: undefined,
    });
  });

  it("normalizes request paths and excludes health and client-log noise", () => {
    expect(stablePath("/__biu_sync/sync/favorites/token_12345678901234567890123456789012")).toBe(
      "/__biu_sync/sync/favorites/:token",
    );
    expect(isTraceableWebPath("/__biu_sync/session")).toBe(true);
    expect(isTraceableWebPath("/__biu_health")).toBe(false);
    expect(isTraceableWebPath("/__biu_log")).toBe(false);
    expect(isTraceableWebPath("/static/js/index.js")).toBe(false);
  });
});

describe("Web Sentry request lifecycle", () => {
  it("adds a request id to every response and preserves it for a request", () => {
    const request = {} as IncomingMessage;
    const response = { setHeader: vi.fn() } as unknown as ServerResponse;

    const first = ensureWebRequestId(request, response);
    const second = ensureWebRequestId(request, response);

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
    expect(response.setHeader).toHaveBeenLastCalledWith("X-Request-ID", first);
  });

  it("runs non-traceable requests without requiring a Sentry DSN", async () => {
    const handler = vi.fn(async () => undefined);
    const request = Object.assign({ headers: {} }, { method: "GET", url: "/" }) as IncomingMessage;
    const response = { statusCode: 200 } as ServerResponse;

    await withWebRequestMonitoring(request, response, "request-id", handler);
    expect(handler).toHaveBeenCalledOnce();
  });
});
