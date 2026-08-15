// @vitest-environment node

import type { IncomingMessage, ServerResponse } from "node:http";

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { BILIBILI_MEDIA_PROXY_PREFIX, BILIBILI_UPSTREAMS, isBilibiliMediaProxyUrl } from "@shared/bilibili-web-proxy";

import { injectCsrfIntoBody, injectCsrfIntoQuery } from "../web-server/csrf";
import { rewriteBilibiliMediaPayload } from "../web-server/media-response";
import { MEDIA_SESSION_COOKIE_NAME, MediaSessionStore } from "../web-server/media-session-store";
import { MediaTokenStore } from "../web-server/media-token-store";
import { isCrossSiteRequest } from "../web-server/proxy-common";
import {
  isAllowedBilibiliMediaUrl,
  matchBilibiliApiProxyRequest,
  matchBilibiliMediaProxyToken,
} from "../web-server/routes";

const MEDIA_TARGET = "https://upos-sz-mirror08h.bilivideo.com/upgcxcode/test/audio.m4s?e=ig8euxZM2rNcNbhB7WdVhoM";
const PCDN_TARGET = "https://xy123.mcdn.bilivideo.cn:8082/upgcxcode/test/audio.m4s";
const MEDIA_TOKEN = "m".repeat(43);
const MEDIA_SESSION_TOKEN = "s".repeat(43);

function request(headers: Record<string, string>, method = "POST") {
  const incoming = Readable.from([]) as IncomingMessage;
  Object.assign(incoming, { headers, method, url: "/" });
  Object.defineProperty(incoming, "socket", { configurable: true, value: {} });
  return incoming;
}

function responseHeaders() {
  const headers = new Map<string, string | number | readonly string[]>();
  return {
    headers,
    response: {
      getHeader(name: string) {
        return headers.get(name.toLowerCase());
      },
      setHeader(name: string, value: string | number | readonly string[]) {
        headers.set(name.toLowerCase(), value);
        return this;
      },
    } as unknown as ServerResponse,
  };
}

describe("Web Bilibili proxy contracts", () => {
  it("maps only fixed API prefixes while preserving path and query", () => {
    const matched = matchBilibiliApiProxyRequest(
      `${BILIBILI_UPSTREAMS.api.proxyPrefix}/x/web-interface/nav?foo=1&encoded=%2Fkeep`,
    );

    expect(matched?.upstream).toBe("api");
    expect(matched?.target.toString()).toBe("https://api.bilibili.com/x/web-interface/nav?foo=1&encoded=%2Fkeep");
    expect(matchBilibiliApiProxyRequest("/__biu_proxy/bilibili/unknown?target=https://evil.example")).toBeUndefined();
  });

  it("recognizes only root-relative opaque media URLs", () => {
    const valid = `${BILIBILI_MEDIA_PROXY_PREFIX}/${MEDIA_TOKEN}`;
    expect(isBilibiliMediaProxyUrl(valid)).toBe(true);
    expect(matchBilibiliMediaProxyToken(valid)).toBe(MEDIA_TOKEN);
    expect(isBilibiliMediaProxyUrl(`https://evil.example${valid}`)).toBe(false);
    expect(isBilibiliMediaProxyUrl(`${valid}?url=https://evil.example`)).toBe(false);
    expect(
      matchBilibiliMediaProxyToken(`${BILIBILI_MEDIA_PROXY_PREFIX}?url=${encodeURIComponent(MEDIA_TARGET)}`),
    ).toBeUndefined();
  });

  it("allows only stable HTTPS UPOS paths and ports", () => {
    expect(isAllowedBilibiliMediaUrl(MEDIA_TARGET)).toBe(true);
    expect(isAllowedBilibiliMediaUrl(MEDIA_TARGET.replace("https://", "http://"))).toBe(false);
    expect(isAllowedBilibiliMediaUrl("https://xy123.mcdn.bilivideo.cn:8082/upgcxcode/test.m4s")).toBe(false);
    expect(isAllowedBilibiliMediaUrl("https://upos-sz-mirror08h.bilivideo.com:444/upgcxcode/test.m4s")).toBe(false);
    expect(isAllowedBilibiliMediaUrl("https://upos-sz-mirror08h.bilivideo.com/not-media/test.json")).toBe(false);
    expect(isAllowedBilibiliMediaUrl("https://evil@upos-sz-mirror08h.bilivideo.com/upgcxcode/test.m4s")).toBe(false);
  });
});

describe("Web proxy CSRF injection", () => {
  it("overwrites JSON, urlencoded, and query values with the server token", () => {
    const json = injectCsrfIntoBody(
      Buffer.from(JSON.stringify({ csrf: "browser-value", message: "hello" })),
      "application/json",
      "server-token",
    );
    expect(JSON.parse(json.toString())).toEqual({
      csrf: "server-token",
      csrf_token: "server-token",
      message: "hello",
    });

    const form = injectCsrfIntoBody(
      Buffer.from("csrf=browser-value&message=hello"),
      "application/x-www-form-urlencoded; charset=UTF-8",
      "server-token",
    );
    expect(new URLSearchParams(form.toString()).getAll("csrf")).toEqual(["server-token"]);
    expect(new URLSearchParams(form.toString()).getAll("csrf_token")).toEqual(["server-token"]);

    const target = new URL("https://api.bilibili.com/x/test?csrf=browser-value");
    injectCsrfIntoQuery(target, "server-token");
    expect(target.searchParams.getAll("csrf")).toEqual(["server-token"]);
    expect(target.searchParams.getAll("csrf_token")).toEqual(["server-token"]);
  });

  it("rebuilds multipart bodies without corrupting binary files or retaining browser CSRF", () => {
    const boundary = "----BiuBoundary0123456789";
    const fileBytes = Buffer.from([0, 255, 13, 10, 45, 45, 1, 2, 3]);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="csrf"\r\n\r\nbrowser-value\r\n`),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="cover"; filename="cover.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      fileBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const injected = injectCsrfIntoBody(body, `multipart/form-data; boundary=${boundary}`, "server-token");
    expect(injected.includes(fileBytes)).toBe(true);
    expect(injected.toString("latin1")).not.toContain("browser-value");
    expect(injected.toString("latin1").match(/name="csrf"/g)).toHaveLength(1);
    expect(injected.toString("latin1").match(/name="csrf_token"/g)).toHaveLength(1);
    expect(injected.toString("latin1")).toContain("server-token");
  });
});

describe("Web media session and token stores", () => {
  it("keeps media identity stable across authentication cookie changes", () => {
    const sessions = new MediaSessionStore({ randomToken: () => MEDIA_SESSION_TOKEN });
    const response = responseHeaders();
    const sessionId = sessions.resolveOrCreate(request({}, "GET"), response.response);
    const setCookie = String(response.headers.get("set-cookie"));

    expect(setCookie).toContain(`${MEDIA_SESSION_COOKIE_NAME}=${MEDIA_SESSION_TOKEN}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toContain("SESSDATA");
    expect(
      sessions.resolve(
        request(
          { cookie: `${MEDIA_SESSION_COOKIE_NAME}=${MEDIA_SESSION_TOKEN}; __Host-biu_session=logged-in-session` },
          "GET",
        ),
      ),
    ).toBe(sessionId);
  });

  it("uses fallback TTL when an allowed URL has no deadline and binds tokens to one media session", () => {
    let now = 1_000;
    const tokens = new MediaTokenStore({
      now: () => now,
      randomToken: () => MEDIA_TOKEN,
      tokenTtlMs: 5_000,
    });
    const proxyUrl = tokens.register(MEDIA_TARGET, "session-a");

    expect(proxyUrl).toBe(`${BILIBILI_MEDIA_PROXY_PREFIX}/${MEDIA_TOKEN}`);
    expect(tokens.resolve(MEDIA_TOKEN, "session-a")?.toString()).toBe(MEDIA_TARGET);
    expect(tokens.resolve(MEDIA_TOKEN, "session-b")).toBeUndefined();
    now = 6_001;
    expect(tokens.resolve(MEDIA_TOKEN, "session-a")).toBeUndefined();
  });

  it("rewrites every playurl/audio URL field without leaving upstream URLs in JSON", () => {
    let tokenIndex = 0;
    const secondTarget = MEDIA_TARGET.replace("audio.m4s", "backup.m4s");
    const result = rewriteBilibiliMediaPayload(
      {
        data: {
          cdns: [MEDIA_TARGET, PCDN_TARGET],
          dash: {
            audio: [{ backupUrl: [secondTarget], baseUrl: MEDIA_TARGET }],
            dolby: { audio: [{ backup_url: [secondTarget], base_url: MEDIA_TARGET }] },
            flac: { audio: { backupUrl: [secondTarget], baseUrl: MEDIA_TARGET } },
            video: [{ backup_url: [secondTarget], base_url: MEDIA_TARGET }],
          },
          durl: [{ backup_url: [secondTarget, PCDN_TARGET], url: MEDIA_TARGET }],
        },
      },
      () => `${BILIBILI_MEDIA_PROXY_PREFIX}/${String(++tokenIndex).padStart(32, "a")}`,
    );
    const serialized = JSON.stringify(result.payload);

    expect(result.rewritten).toBe(2);
    expect(serialized).not.toContain("bilivideo.com");
    expect(serialized).not.toContain("mcdn");
    expect(serialized).not.toContain("https://");
    expect(serialized).toContain(BILIBILI_MEDIA_PROXY_PREFIX);
  });
});

describe("Web proxy same-origin enforcement", () => {
  it("compares scheme and real Host while ignoring spoofed forwarded headers", () => {
    expect(
      isCrossSiteRequest(
        request({
          host: "biu.example",
          origin: "https://biu.example",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "http",
        }),
        "https://biu.example",
      ),
    ).toBe(false);
    expect(
      isCrossSiteRequest(request({ host: "biu.example", origin: "http://biu.example" }), "https://biu.example"),
    ).toBe(true);
    expect(
      isCrossSiteRequest(request({ host: "wrong.example", origin: "https://biu.example" }), "https://biu.example"),
    ).toBe(true);
  });
});
