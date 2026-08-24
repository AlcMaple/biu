import type { IncomingMessage, ServerResponse } from "node:http";

import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BilibiliAuthClient, BilibiliUpstreamError, parseBilibiliSetCookie } from "../web-server/auth/bilibili-auth";
import { createWebAuthHandler, createWebSessionResolver } from "../web-server/auth/handler";
import {
  PendingLoginCapacityError,
  PendingLoginStore,
  WEB_LOGIN_COOKIE_NAME,
} from "../web-server/auth/pending-login-store";
import { QrRateLimiter } from "../web-server/auth/rate-limit";
import {
  WEB_SESSION_REFRESH_CHECK_INTERVAL_MS,
  WebSessionRefreshCoordinator,
} from "../web-server/auth/session-refresh";
import {
  WEB_SESSION_COOKIE_NAME,
  WebSessionStore,
  findBilibiliCookie,
  formatBilibiliCookieHeader,
  mergeBilibiliCookies,
  type BilibiliCookie,
} from "../web-server/auth/session-store";

const LOGIN_ID = "l".repeat(32);
const LOGIN_BROWSER_TOKEN_A = "q".repeat(43);
const LOGIN_BROWSER_TOKEN_B = "r".repeat(43);
const SESSION_TOKEN_A = "a".repeat(43);
const SESSION_TOKEN_B = "b".repeat(43);
const API_TARGET = "https://api.bilibili.com/x/web-interface/nav";

const biliCookie = (
  name: string,
  value: string,
  overrides: Partial<Omit<BilibiliCookie, "name" | "value">> = {},
): BilibiliCookie => ({
  domain: "bilibili.com",
  hostOnly: false,
  name,
  path: "/",
  value,
  ...overrides,
});

type MockResponse = {
  body: string;
  headers: Map<string, string | number | readonly string[]>;
  response: ServerResponse;
};

function createRequest(
  method: string,
  url: string,
  options: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): IncomingMessage {
  const body = options.body === undefined ? [] : [JSON.stringify(options.body)];
  const request = Readable.from(body) as IncomingMessage;
  Object.assign(request, {
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    method,
    url,
  });
  Object.defineProperty(request, "socket", {
    configurable: true,
    value: { remoteAddress: "127.0.0.1" },
  });
  return request;
}

function createResponse(): MockResponse {
  const target = {
    body: "",
    headers: new Map<string, string | number | readonly string[]>(),
    statusCode: 200,
    writableEnded: false,
    end(chunk?: string | Buffer) {
      this.body = chunk?.toString() ?? "";
      this.writableEnded = true;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      this.headers.set(name.toLowerCase(), value);
      return this;
    },
    getHeader(name: string) {
      return this.headers.get(name.toLowerCase());
    },
  };

  return {
    get body() {
      return target.body;
    },
    headers: target.headers,
    response: target as unknown as ServerResponse,
  };
}

const cookieRequest = (token: string) => createRequest("GET", "/", { cookie: `${WEB_SESSION_COOKIE_NAME}=${token}` });
const loginCookie = (token: string) => `${WEB_LOGIN_COOKIE_NAME}=${token}`;

function setCookieValue(header: string | number | readonly string[] | undefined, name: string): string | undefined {
  const cookies = Array.isArray(header) ? header : header === undefined ? [] : [String(header)];
  return cookies
    .map(cookie => cookie.split(";", 1)[0])
    .find(cookie => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

describe("Web server session store", () => {
  it("keeps Bilibili cookies isolated behind independent opaque sessions", () => {
    const tokens = [SESSION_TOKEN_A, SESSION_TOKEN_B];
    const store = new WebSessionStore({ randomToken: () => tokens.shift() ?? "c".repeat(43) });
    const first = store.createSession({ cookies: [biliCookie("SESSDATA", "first-secret")] });
    store.createSession({ cookies: [biliCookie("SESSDATA", "second-secret")] });

    expect(first.cookieHeader).toContain(`${WEB_SESSION_COOKIE_NAME}=${SESSION_TOKEN_A}`);
    expect(first.cookieHeader).toContain("HttpOnly");
    expect(first.cookieHeader).toContain("Secure");
    expect(first.cookieHeader).toContain("SameSite=Lax");
    expect(first.cookieHeader).not.toContain("first-secret");
    expect(store.resolveCookieFor(cookieRequest(SESSION_TOKEN_A), API_TARGET)).toBe("SESSDATA=first-secret");
    expect(store.resolveCookieFor(cookieRequest(SESSION_TOKEN_B), API_TARGET)).toBe("SESSDATA=second-secret");
    expect(store.resolveCookieFor(cookieRequest("z".repeat(43)), API_TARGET)).toBeUndefined();
  });

  it("merges upstream Set-Cookie updates and removes expired cookies", () => {
    const now = Date.parse("2026-08-15T00:00:00Z");
    const updated = parseBilibiliSetCookie(
      "bili_jct=next; Domain=.bilibili.com; Path=/; Max-Age=3600; HttpOnly; Secure",
      API_TARGET,
      now,
    );
    const removed = parseBilibiliSetCookie("SESSDATA=; Domain=.bilibili.com; Max-Age=0; Path=/", API_TARGET, now);
    const merged = mergeBilibiliCookies(
      [biliCookie("bili_jct", "old"), biliCookie("SESSDATA", "secret")],
      [updated!, removed!],
      now,
    );

    expect(findBilibiliCookie(merged.values(), "bili_jct", API_TARGET, now)).toMatchObject({
      value: "next",
      expiresAt: now + 3_600_000,
    });
    expect(findBilibiliCookie(merged.values(), "SESSDATA", API_TARGET, now)).toBeUndefined();

    const clearedWithoutExpiry = parseBilibiliSetCookie(
      "bili_jct=; Domain=.bilibili.com; Path=/; HttpOnly",
      API_TARGET,
      now,
    );
    const cleared = mergeBilibiliCookies(merged.values(), [clearedWithoutExpiry!], now);
    expect(findBilibiliCookie(cleared.values(), "bili_jct", API_TARGET, now)).toBeUndefined();
  });

  it("keeps host-only and path-scoped cookies on their exact upstream targets", () => {
    const apiCookie = parseBilibiliSetCookie("scope=api; Path=/", "https://api.bilibili.com/x/nav")!;
    const passportCookie = parseBilibiliSetCookie("scope=passport; Path=/", "https://passport.bilibili.com/x/login")!;
    const privateCookie = parseBilibiliSetCookie(
      "private=only; Path=/x/private",
      "https://api.bilibili.com/x/private/start",
    )!;
    const domainCookie = parseBilibiliSetCookie(
      "shared=all; Domain=.bilibili.com; Path=/",
      "https://api.bilibili.com/x/nav",
    )!;
    const cookies = mergeBilibiliCookies([], [apiCookie, passportCookie, privateCookie, domainCookie]);

    expect(formatBilibiliCookieHeader(cookies.values(), "https://api.bilibili.com/x/public")).toBe(
      "scope=api; shared=all",
    );
    expect(formatBilibiliCookieHeader(cookies.values(), "https://passport.bilibili.com/x/login")).toBe(
      "scope=passport; shared=all",
    );
    expect(formatBilibiliCookieHeader(cookies.values(), "https://api.bilibili.com/x/private/item")).toBe(
      "private=only; scope=api; shared=all",
    );
    expect(
      parseBilibiliSetCookie("stolen=value; Domain=evil.example; Path=/", "https://api.bilibili.com/x/nav"),
    ).toBeUndefined();
  });

  it("does not let a Domain cookie overwrite an equally named host-only cookie", () => {
    const hostOnly = parseBilibiliSetCookie("same=host-only; Path=/", API_TARGET)!;
    const domain = parseBilibiliSetCookie("same=domain; Domain=api.bilibili.com; Path=/", API_TARGET)!;
    const cookies = mergeBilibiliCookies([], [hostOnly, domain]);

    expect(cookies.size).toBe(2);
    expect(formatBilibiliCookieHeader(cookies.values(), API_TARGET)).toBe("same=host-only; same=domain");
    expect(formatBilibiliCookieHeader(cookies.values(), "https://member.bilibili.com/x/nav")).toBe("");
  });

  it("gives the proxy an opaque binding id and captures upstream Cookie rotation", async () => {
    const store = new WebSessionStore({ randomToken: () => SESSION_TOKEN_A });
    store.createSession({ cookies: [biliCookie("SESSDATA", "first-secret")] });
    const resolver = createWebSessionResolver(store);

    const resolved = await resolver(cookieRequest(SESSION_TOKEN_A));
    expect(resolved?.sessionId).toMatch(/^[a-f0-9]{64}$/);
    expect(resolved?.sessionId).not.toContain(SESSION_TOKEN_A);
    expect(resolved?.cookieHeaderFor(API_TARGET)).toBe("SESSDATA=first-secret");

    resolved?.updateFromSetCookie(
      ["SESSDATA=rotated-secret; Domain=.bilibili.com; Path=/; HttpOnly; Secure"],
      API_TARGET,
    );
    expect(store.resolveCookieFor(cookieRequest(SESSION_TOKEN_A), API_TARGET)).toBe("SESSDATA=rotated-secret");
  });

  it("single-flights due Cookie checks and cools down after an upstream failure", async () => {
    let now = 1_000;
    const store = new WebSessionStore({ now: () => now, randomToken: () => SESSION_TOKEN_A });
    store.createSession({
      cookies: [biliCookie("SESSDATA", "session"), biliCookie("bili_jct", "csrf")],
      refreshToken: "server-only-refresh-secret",
    });
    now += WEB_SESSION_REFRESH_CHECK_INTERVAL_MS + 1;

    let rejectRefresh: ((reason: Error) => void) | undefined;
    const refreshSession = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectRefresh = reject;
        }),
    );
    const coordinator = new WebSessionRefreshCoordinator({
      authClient: { refreshSession },
      now: () => now,
      sessionStore: store,
    });
    const logger = { error: vi.fn(), warn: vi.fn() };
    const resolver = createWebSessionResolver(store, coordinator, logger);

    const first = await resolver(cookieRequest(SESSION_TOKEN_A));
    const concurrent = await resolver(cookieRequest(SESSION_TOKEN_A));
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(first?.cookieHeaderFor(API_TARGET)).toContain("SESSDATA=session");
    expect(concurrent?.cookieHeaderFor(API_TARGET)).toContain("SESSDATA=session");
    rejectRefresh?.(new Error("upstream unavailable"));
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledTimes(1));

    const afterFailure = await resolver(cookieRequest(SESSION_TOKEN_A));
    expect(afterFailure?.cookieHeaderFor(API_TARGET)).toContain("SESSDATA=session");
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("destroys a session when an automatic refresh confirms it is logged out", async () => {
    let now = 1_000;
    const store = new WebSessionStore({ now: () => now, randomToken: () => SESSION_TOKEN_A });
    store.createSession({
      cookies: [biliCookie("SESSDATA", "expired")],
      refreshToken: "refresh",
    });
    now += WEB_SESSION_REFRESH_CHECK_INTERVAL_MS + 1;

    const coordinator = new WebSessionRefreshCoordinator({
      authClient: {
        refreshSession: vi.fn().mockRejectedValue(new BilibiliUpstreamError("logged out", 401)),
      },
      now: () => now,
      sessionStore: store,
    });

    const logger = { error: vi.fn(), warn: vi.fn() };
    const resolver = createWebSessionResolver(store, coordinator, logger);
    const firstResponse = createResponse();
    const first = await resolver(cookieRequest(SESSION_TOKEN_A), firstResponse.response);
    expect(first?.cookieHeaderFor(API_TARGET)).toContain("SESSDATA=expired");
    expect(firstResponse.headers.has("set-cookie")).toBe(false);
    await vi.waitFor(() => expect(store.size).toBe(0));

    const nextResponse = createResponse();
    await expect(resolver(cookieRequest(SESSION_TOKEN_A), nextResponse.response)).resolves.toBeUndefined();
    expect(String(nextResponse.headers.get("set-cookie"))).toContain(`${WEB_SESSION_COOKIE_NAME}=`);
    expect(String(nextResponse.headers.get("set-cookie"))).toContain("Max-Age=0");
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight refresh between forced manual requests", async () => {
    const store = new WebSessionStore({ randomToken: () => SESSION_TOKEN_A });
    store.createSession({
      cookies: [biliCookie("SESSDATA", "session")],
      refreshToken: "refresh",
    });
    const resolved = store.resolveSessionRecord(cookieRequest(SESSION_TOKEN_A))!;
    let resolveRefresh: ((result: Awaited<ReturnType<BilibiliAuthClient["refreshSession"]>>) => void) | undefined;
    const refreshSession = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<BilibiliAuthClient["refreshSession"]>>>(resolve => {
          resolveRefresh = resolve;
        }),
    );
    const coordinator = new WebSessionRefreshCoordinator({
      authClient: { refreshSession },
      sessionStore: store,
    });

    const first = coordinator.refreshNow(resolved);
    const second = coordinator.refreshNow(resolved);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    resolveRefresh?.({ cookies: new Map(resolved.session.cookies), refreshToken: "next", refreshed: true });

    await expect(first).resolves.toMatchObject({ refreshed: true });
    await expect(second).resolves.toMatchObject({ refreshed: true });
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});

describe("Web login abuse controls", () => {
  it("enforces global limits without treating an untrusted proxy peer as one client", () => {
    const limiter = new QrRateLimiter({
      create: { globalLimit: 2, perIpLimit: 1, windowMs: 60_000 },
      now: () => 1_000,
    });

    expect(limiter.consume("create").allowed).toBe(true);
    expect(limiter.consume("create").allowed).toBe(true);
    expect(limiter.consume("create").allowed).toBe(false);
  });

  it("enforces a bounded pending-login store", () => {
    const store = new PendingLoginStore({ maxEntries: 1, randomId: () => LOGIN_ID });
    store.create("first-auth-code");

    expect(() => store.create("second-auth-code")).toThrow(PendingLoginCapacityError);
    expect(store.size).toBe(1);
  });

  it("limits SMS sends for one phone even across different trusted client addresses", () => {
    const limiter = new QrRateLimiter({
      now: () => 1_000,
      smsSend: { globalLimit: 10, perIpLimit: 10, perSubjectLimit: 1, windowMs: 60_000 },
    });

    expect(limiter.consume("smsSend", "198.51.100.7", "hashed-phone").allowed).toBe(true);
    expect(limiter.consume("smsSend", "203.0.113.9", "hashed-phone").allowed).toBe(false);
  });
});

describe("Web QR authentication handler", () => {
  const logger = { error: vi.fn(), warn: vi.fn() };
  const authClient = {
    createQrCode: vi.fn(),
    createSmsCaptcha: vi.fn(),
    getUser: vi.fn(),
    loginWithSms: vi.fn(),
    logout: vi.fn(),
    pollQrCode: vi.fn(),
    refreshSession: vi.fn(),
    sendSmsCode: vi.fn(),
  };

  beforeEach(() => {
    authClient.createQrCode.mockResolvedValue({ authCode: "server-only-auth-code", url: "https://qr.example" });
    authClient.createSmsCaptcha.mockResolvedValue({
      captcha: {
        geetest: { challenge: "server-only-challenge", gt: "server-only-gt" },
        token: "server-only-risk-token",
        type: "geetest",
      },
      cookies: [biliCookie("buvid3", "server-only-prelogin-cookie")],
    });
    authClient.sendSmsCode.mockResolvedValue({
      captchaKey: "server-only-sms-ticket",
      code: 0,
      cookies: [biliCookie("buvid3", "server-only-prelogin-cookie")],
      message: "0",
    });
    authClient.loginWithSms.mockResolvedValue({
      code: 0,
      cookies: [biliCookie("SESSDATA", "server-only-session"), biliCookie("bili_jct", "server-only-csrf")],
      message: "0",
      refreshToken: "server-only-refresh-token",
    });
    authClient.pollQrCode.mockResolvedValue({
      code: 0,
      cookies: [biliCookie("SESSDATA", "server-only-session"), biliCookie("bili_jct", "server-only-csrf")],
      message: "0",
      mid: 42,
      refreshToken: "server-only-refresh-token",
    });
    authClient.getUser.mockResolvedValue({ isLogin: true, mid: 42, uname: "Biu" });
    authClient.logout.mockResolvedValue(true);
    authClient.refreshSession.mockImplementation(async session => ({
      cookies: new Map(session.cookies),
      refreshToken: session.refreshToken,
      refreshed: false,
    }));
  });

  it("exposes only a random login transaction and sets an own-site session after validation", async () => {
    const sessions = new WebSessionStore({ randomToken: () => SESSION_TOKEN_A });
    const pending = new PendingLoginStore({
      randomBrowserToken: () => LOGIN_BROWSER_TOKEN_A,
      randomId: () => LOGIN_ID,
    });
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      pendingLoginStore: pending,
      sessionStore: sessions,
    });

    const createResponseTarget = createResponse();
    await handler(createRequest("POST", "/__biu_auth/qrcode"), createResponseTarget.response);
    const created = JSON.parse(createResponseTarget.body) as { data: { loginId: string; url: string } };
    expect(created.data).toEqual({ expiresAt: expect.any(Number), loginId: LOGIN_ID, url: "https://qr.example" });
    expect(createResponseTarget.body).not.toContain("server-only-auth-code");
    const browserToken = setCookieValue(createResponseTarget.headers.get("set-cookie"), WEB_LOGIN_COOKIE_NAME);
    expect(browserToken).toBe(LOGIN_BROWSER_TOKEN_A);
    expect(String(createResponseTarget.headers.get("set-cookie"))).toContain("SameSite=Strict");
    expect(String(createResponseTarget.headers.get("set-cookie"))).not.toContain("server-only-auth-code");

    const pollResponseTarget = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: created.data.loginId },
        cookie: loginCookie(browserToken!),
      }),
      pollResponseTarget.response,
    );

    const ownCookie = String(pollResponseTarget.headers.get("set-cookie"));
    expect(ownCookie).toContain(`${WEB_SESSION_COOKIE_NAME}=${SESSION_TOKEN_A}`);
    expect(ownCookie).toContain("HttpOnly");
    expect(ownCookie).toContain("Secure");
    expect(pollResponseTarget.body).not.toContain("server-only-session");
    expect(pollResponseTarget.body).not.toContain("server-only-csrf");
    expect(pollResponseTarget.body).not.toContain("server-only-refresh-token");
    expect(ownCookie).toContain(`${WEB_LOGIN_COOKIE_NAME}=`);
    expect(ownCookie).toContain("Max-Age=0");
    expect(sessions.resolveCookieFor(cookieRequest(SESSION_TOKEN_A), API_TARGET)).toBe(
      "bili_jct=server-only-csrf; SESSDATA=server-only-session",
    );

    const replayResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: created.data.loginId },
        cookie: loginCookie(browserToken!),
      }),
      replayResponse.response,
    );
    expect(JSON.parse(replayResponse.body)).toMatchObject({ code: 86038 });
  });

  it("keeps SMS credentials in the server transaction and issues the same opaque session after validation", async () => {
    const sessions = new WebSessionStore({ randomToken: () => SESSION_TOKEN_A });
    const pending = new PendingLoginStore({
      randomBrowserToken: () => LOGIN_BROWSER_TOKEN_A,
      randomId: () => LOGIN_ID,
    });
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      pendingLoginStore: pending,
      sessionStore: sessions,
    });

    const captchaResponse = createResponse();
    await handler(createRequest("POST", "/__biu_auth/sms/captcha"), captchaResponse.response);
    const captcha = JSON.parse(captchaResponse.body) as {
      data: { captcha: { geetest: { challenge: string; gt: string }; token: string }; loginId: string };
    };
    const browserToken = setCookieValue(captchaResponse.headers.get("set-cookie"), WEB_LOGIN_COOKIE_NAME);
    expect(captcha.data).toMatchObject({
      captcha: {
        geetest: { challenge: "server-only-challenge", gt: "server-only-gt" },
        token: "server-only-risk-token",
      },
      loginId: LOGIN_ID,
    });
    expect(captchaResponse.body).not.toContain("server-only-prelogin-cookie");

    const sendResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/sms/send", {
        body: {
          challenge: "server-only-challenge",
          cid: "86",
          loginId: captcha.data.loginId,
          seccode: "server-only-seccode",
          tel: "13800138000",
          token: "server-only-risk-token",
          validate: "server-only-validate",
        },
        cookie: loginCookie(browserToken!),
      }),
      sendResponse.response,
    );
    expect(JSON.parse(sendResponse.body)).toMatchObject({ code: 0 });
    expect(sendResponse.body).not.toContain("server-only-sms-ticket");
    expect(authClient.sendSmsCode).toHaveBeenCalledWith(
      expect.objectContaining({
        cid: "86",
        cookies: [biliCookie("buvid3", "server-only-prelogin-cookie")],
        tel: "13800138000",
      }),
    );

    const loginResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/sms/login", {
        body: { code: "123456", loginId: captcha.data.loginId },
        cookie: loginCookie(browserToken!),
      }),
      loginResponse.response,
    );

    const ownCookie = String(loginResponse.headers.get("set-cookie"));
    expect(JSON.parse(loginResponse.body)).toMatchObject({ code: 0, data: { user: { mid: 42 } } });
    expect(loginResponse.body).not.toContain("server-only-session");
    expect(loginResponse.body).not.toContain("server-only-csrf");
    expect(loginResponse.body).not.toContain("server-only-refresh-token");
    expect(ownCookie).toContain(`${WEB_SESSION_COOKIE_NAME}=${SESSION_TOKEN_A}`);
    expect(ownCookie).toContain(`${WEB_LOGIN_COOKIE_NAME}=`);
    expect(ownCookie).toContain("Max-Age=0");
    expect(sessions.resolveCookieFor(cookieRequest(SESSION_TOKEN_A), API_TARGET)).toContain(
      "SESSDATA=server-only-session",
    );

    const replayResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/sms/login", {
        body: { code: "123456", loginId: captcha.data.loginId },
        cookie: loginCookie(browserToken!),
      }),
      replayResponse.response,
    );
    expect(JSON.parse(replayResponse.body)).toMatchObject({ code: -409 });
  });

  it("binds a QR transaction to the browser that created it", async () => {
    const pending = new PendingLoginStore({
      randomBrowserToken: () => LOGIN_BROWSER_TOKEN_A,
      randomId: () => LOGIN_ID,
    });
    const issued = pending.create("server-only-auth-code");
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      pendingLoginStore: pending,
    });

    const foreignResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: LOGIN_ID },
        cookie: loginCookie(LOGIN_BROWSER_TOKEN_B),
      }),
      foreignResponse.response,
    );
    expect(JSON.parse(foreignResponse.body)).toMatchObject({ code: 86038 });
    expect(authClient.pollQrCode).not.toHaveBeenCalled();

    const ownerResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: LOGIN_ID },
        cookie: loginCookie(issued.browserToken),
      }),
      ownerResponse.response,
    );
    expect(JSON.parse(ownerResponse.body)).toMatchObject({ code: 0 });
    expect(authClient.pollQrCode).toHaveBeenCalledTimes(1);
  });

  it("binds an SMS transaction to the browser that created it", async () => {
    const pending = new PendingLoginStore({
      randomBrowserToken: () => LOGIN_BROWSER_TOKEN_A,
      randomId: () => LOGIN_ID,
    });
    const issued = pending.createSms([biliCookie("buvid3", "server-only-prelogin-cookie")]);
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      pendingLoginStore: pending,
    });

    const responseTarget = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/sms/send", {
        body: {
          challenge: "challenge",
          cid: "86",
          loginId: LOGIN_ID,
          seccode: "seccode",
          tel: "13800138000",
          token: "token",
          validate: "validate",
        },
        cookie: loginCookie(LOGIN_BROWSER_TOKEN_B),
      }),
      responseTarget.response,
    );

    expect(issued.browserToken).toBe(LOGIN_BROWSER_TOKEN_A);
    expect(JSON.parse(responseTarget.body)).toMatchObject({ code: -409 });
    expect(authClient.sendSmsCode).not.toHaveBeenCalled();
  });

  it("rotates the browser binding and invalidates the prior QR when generating again", async () => {
    const browserTokens = [LOGIN_BROWSER_TOKEN_A, LOGIN_BROWSER_TOKEN_B];
    const loginIds = [LOGIN_ID, "m".repeat(32)];
    const pending = new PendingLoginStore({
      randomBrowserToken: () => browserTokens.shift()!,
      randomId: () => loginIds.shift()!,
    });
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      pendingLoginStore: pending,
    });

    const firstResponse = createResponse();
    await handler(createRequest("POST", "/__biu_auth/qrcode"), firstResponse.response);
    const first = JSON.parse(firstResponse.body) as { data: { loginId: string } };

    const secondResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode", { cookie: loginCookie(LOGIN_BROWSER_TOKEN_A) }),
      secondResponse.response,
    );
    expect(setCookieValue(secondResponse.headers.get("set-cookie"), WEB_LOGIN_COOKIE_NAME)).toBe(LOGIN_BROWSER_TOKEN_B);

    const staleResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: first.data.loginId },
        cookie: loginCookie(LOGIN_BROWSER_TOKEN_A),
      }),
      staleResponse.response,
    );
    expect(JSON.parse(staleResponse.body)).toMatchObject({ code: 86038 });
    expect(authClient.pollQrCode).not.toHaveBeenCalled();
  });

  it("destroys the local session even when upstream logout fails", async () => {
    authClient.logout.mockRejectedValueOnce(new Error("upstream unavailable"));
    const sessions = new WebSessionStore({ randomToken: () => SESSION_TOKEN_A });
    sessions.createSession({
      cookies: [biliCookie("SESSDATA", "session"), biliCookie("bili_jct", "csrf")],
    });
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      sessionStore: sessions,
    });
    const responseTarget = createResponse();

    await handler(
      createRequest("POST", "/__biu_auth/logout", {
        cookie: `${WEB_SESSION_COOKIE_NAME}=${SESSION_TOKEN_A}`,
      }),
      responseTarget.response,
    );

    expect(sessions.size).toBe(0);
    expect(String(responseTarget.headers.get("set-cookie"))).toContain("Max-Age=0");
    expect(JSON.parse(responseTarget.body)).toMatchObject({ code: 0, data: { upstreamLoggedOut: false } });
  });

  it("consumes fatal QR states while keeping only pending states pollable", async () => {
    const pending = new PendingLoginStore({
      randomBrowserToken: () => LOGIN_BROWSER_TOKEN_A,
      randomId: () => LOGIN_ID,
    });
    const issued = pending.create("server-only-auth-code");
    authClient.pollQrCode.mockResolvedValueOnce({ code: 86090, cookies: [], message: "未扫码" });
    authClient.pollQrCode.mockResolvedValueOnce({ code: -412, cookies: [], message: "请求被拦截" });
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      pendingLoginStore: pending,
    });

    const pendingResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: LOGIN_ID },
        cookie: loginCookie(issued.browserToken),
      }),
      pendingResponse.response,
    );
    expect(JSON.parse(pendingResponse.body)).toMatchObject({ code: 86090 });

    const fatalResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: LOGIN_ID },
        cookie: loginCookie(issued.browserToken),
      }),
      fatalResponse.response,
    );
    expect(JSON.parse(fatalResponse.body)).toMatchObject({ code: -412 });
    expect(String(fatalResponse.headers.get("set-cookie"))).toContain(`${WEB_LOGIN_COOKIE_NAME}=`);
    expect(String(fatalResponse.headers.get("set-cookie"))).toContain("Max-Age=0");

    const replayResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: LOGIN_ID },
        cookie: loginCookie(issued.browserToken),
      }),
      replayResponse.response,
    );
    expect(JSON.parse(replayResponse.body)).toMatchObject({ code: 86038 });
    expect(authClient.pollQrCode).toHaveBeenCalledTimes(2);
  });

  it("returns an overlapping poll as HTTP 200 pending instead of aborting the UI", async () => {
    const pending = new PendingLoginStore({
      randomBrowserToken: () => LOGIN_BROWSER_TOKEN_A,
      randomId: () => LOGIN_ID,
    });
    const issued = pending.create("server-only-auth-code");
    let resolvePoll: ((value: { code: number; cookies: never[]; message: string }) => void) | undefined;
    authClient.pollQrCode.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolvePoll = resolve;
        }),
    );
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      pendingLoginStore: pending,
    });

    const firstResponse = createResponse();
    const firstPoll = handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: LOGIN_ID },
        cookie: loginCookie(issued.browserToken),
      }),
      firstResponse.response,
    );
    await vi.waitFor(() => expect(authClient.pollQrCode).toHaveBeenCalledTimes(1));

    const overlapResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: LOGIN_ID },
        cookie: loginCookie(issued.browserToken),
      }),
      overlapResponse.response,
    );
    expect(overlapResponse.response.statusCode).toBe(200);
    expect(JSON.parse(overlapResponse.body)).toMatchObject({ code: 86039 });

    resolvePoll?.({ code: 86090, cookies: [], message: "未扫码" });
    await firstPoll;
  });

  it("requires complete refreshable credentials and invalidates the redeemed QR transaction", async () => {
    const pending = new PendingLoginStore({
      randomBrowserToken: () => LOGIN_BROWSER_TOKEN_A,
      randomId: () => LOGIN_ID,
    });
    const issued = pending.create("server-only-auth-code");
    authClient.pollQrCode.mockResolvedValueOnce({
      code: 0,
      cookies: [biliCookie("SESSDATA", "session"), biliCookie("bili_jct", "csrf")],
      message: "0",
      mid: 42,
    });
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      pendingLoginStore: pending,
    });

    const responseTarget = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: LOGIN_ID },
        cookie: loginCookie(issued.browserToken),
      }),
      responseTarget.response,
    );
    expect(responseTarget.response.statusCode).toBe(502);

    const replayResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: LOGIN_ID },
        cookie: loginCookie(issued.browserToken),
      }),
      replayResponse.response,
    );
    expect(JSON.parse(replayResponse.body)).toMatchObject({ code: 86038 });
  });

  it("replaces the old browser session only after a successful QR validation", async () => {
    const tokens = [SESSION_TOKEN_A, SESSION_TOKEN_B];
    const sessions = new WebSessionStore({ randomToken: () => tokens.shift() ?? "c".repeat(43) });
    sessions.createSession({ cookies: [biliCookie("SESSDATA", "old-session")] });
    const pending = new PendingLoginStore({
      randomBrowserToken: () => LOGIN_BROWSER_TOKEN_A,
      randomId: () => LOGIN_ID,
    });
    const issued = pending.create("server-only-auth-code");
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      pendingLoginStore: pending,
      sessionStore: sessions,
    });

    const responseTarget = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode/poll", {
        body: { loginId: LOGIN_ID },
        cookie: `${WEB_SESSION_COOKIE_NAME}=${SESSION_TOKEN_A}; ${loginCookie(issued.browserToken)}`,
      }),
      responseTarget.response,
    );

    expect(sessions.size).toBe(1);
    expect(sessions.resolveCookieFor(cookieRequest(SESSION_TOKEN_A), API_TARGET)).toBeUndefined();
    expect(sessions.resolveCookieFor(cookieRequest(SESSION_TOKEN_B), API_TARGET)).toContain(
      "SESSDATA=server-only-session",
    );
  });

  it("forces a manual refresh even inside the automatic two-day cooldown", async () => {
    const sessions = new WebSessionStore({ randomToken: () => SESSION_TOKEN_A });
    sessions.createSession({
      cookies: [biliCookie("SESSDATA", "session"), biliCookie("bili_jct", "csrf")],
      refreshToken: "server-only-refresh-secret",
    });
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      sessionStore: sessions,
    });

    const responseTarget = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/session/refresh", {
        cookie: `${WEB_SESSION_COOKIE_NAME}=${SESSION_TOKEN_A}`,
      }),
      responseTarget.response,
    );

    expect(responseTarget.response.statusCode).toBe(200);
    expect(authClient.refreshSession).toHaveBeenCalledTimes(1);
    expect(responseTarget.body).not.toContain("server-only-refresh-secret");
  });

  it("clears an opaque session cookie when its server-side record no longer exists", async () => {
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      sessionStore: new WebSessionStore(),
    });
    const responseTarget = createResponse();

    await handler(
      createRequest("POST", "/__biu_auth/session/refresh", {
        cookie: `${WEB_SESSION_COOKIE_NAME}=${SESSION_TOKEN_A}`,
      }),
      responseTarget.response,
    );

    expect(responseTarget.response.statusCode).toBe(401);
    expect(String(responseTarget.headers.get("set-cookie"))).toContain(`${WEB_SESSION_COOKIE_NAME}=`);
    expect(String(responseTarget.headers.get("set-cookie"))).toContain("Max-Age=0");
  });

  it("rejects cross-site state-changing requests before contacting Bilibili", async () => {
    const handler = createWebAuthHandler({ authClient: authClient as unknown as BilibiliAuthClient, logger });
    const responseTarget = createResponse();

    await handler(
      createRequest("POST", "/__biu_auth/qrcode", { headers: { "sec-fetch-site": "cross-site" } }),
      responseTarget.response,
    );

    expect(responseTarget.response.statusCode).toBe(403);
    expect(authClient.createQrCode).not.toHaveBeenCalled();

    const mismatchedOriginResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode", {
        headers: { host: "biu.example", origin: "https://attacker.example" },
      }),
      mismatchedOriginResponse.response,
    );

    expect(mismatchedOriginResponse.response.statusCode).toBe(403);
    expect(authClient.createQrCode).not.toHaveBeenCalled();

    const forgedForwardedHostResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode", {
        headers: {
          host: "biu.example",
          origin: "https://attacker.example",
          "x-forwarded-host": "attacker.example",
        },
      }),
      forgedForwardedHostResponse.response,
    );
    expect(forgedForwardedHostResponse.response.statusCode).toBe(403);

    const forgedForwardedProtoResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode", {
        headers: {
          host: "biu.example",
          origin: "https://biu.example",
          "x-forwarded-proto": "https",
        },
      }),
      forgedForwardedProtoResponse.response,
    );
    expect(forgedForwardedProtoResponse.response.statusCode).toBe(403);
  });

  it("uses only an explicitly configured single-value client IP header", async () => {
    const limiter = new QrRateLimiter({
      create: { globalLimit: 10, perIpLimit: 1, windowMs: 60_000 },
      now: () => 1_000,
    });
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      clientIpHeader: "x-biu-client-ip",
      logger,
      pendingLoginStore: new PendingLoginStore(),
      qrRateLimiter: limiter,
    });

    const firstResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode", { headers: { "x-biu-client-ip": "198.51.100.7" } }),
      firstResponse.response,
    );
    const secondResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode", { headers: { "x-biu-client-ip": "198.51.100.7" } }),
      secondResponse.response,
    );
    const chainedResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode", {
        headers: { "x-biu-client-ip": "203.0.113.5, 198.51.100.7" },
      }),
      chainedResponse.response,
    );

    expect(firstResponse.response.statusCode).toBe(200);
    expect(secondResponse.response.statusCode).toBe(429);
    expect(chainedResponse.response.statusCode).toBe(200);
    expect(authClient.createQrCode).toHaveBeenCalledTimes(2);
  });

  it("requires both Origin and Host to match the configured public origin", async () => {
    const handler = createWebAuthHandler({
      authClient: authClient as unknown as BilibiliAuthClient,
      logger,
      publicOrigin: "https://biu.example",
    });

    const spoofedHostResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode", {
        headers: { host: "attacker.example", origin: "https://biu.example" },
      }),
      spoofedHostResponse.response,
    );
    expect(spoofedHostResponse.response.statusCode).toBe(403);
    expect(authClient.createQrCode).not.toHaveBeenCalled();

    const validResponse = createResponse();
    await handler(
      createRequest("POST", "/__biu_auth/qrcode", {
        headers: { host: "biu.example", origin: "https://biu.example" },
      }),
      validResponse.response,
    );
    expect(validResponse.response.statusCode).toBe(200);
    expect(authClient.createQrCode).toHaveBeenCalledTimes(1);
  });
});
