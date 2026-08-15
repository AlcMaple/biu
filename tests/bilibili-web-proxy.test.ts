import type { ProxyOptions } from "@rsbuild/core";
import type { ClientRequest, IncomingHttpHeaders } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { BILIBILI_UPSTREAMS, resolveBilibiliBaseURL } from "@shared/bilibili-web-proxy";

import {
  BILIBILI_WEB_PROXY_REQUEST_HEADERS,
  createBilibiliWebProxyConfig,
  overwriteBilibiliProxyRequestHeaders,
  rewriteBilibiliProxyPath,
  stripBilibiliSetCookie,
} from "../plugins/bilibili-web-proxy";

describe("Bilibili Web proxy", () => {
  it("uses fixed same-origin prefixes only for Web", () => {
    for (const [name, endpoint] of Object.entries(BILIBILI_UPSTREAMS)) {
      expect(resolveBilibiliBaseURL(name as keyof typeof BILIBILI_UPSTREAMS, true)).toBe(endpoint.proxyPrefix);
      expect(resolveBilibiliBaseURL(name as keyof typeof BILIBILI_UPSTREAMS, false)).toBe(endpoint.origin);
    }
  });

  it("builds one fixed proxy rule for every allowlisted upstream", () => {
    const proxy = createBilibiliWebProxyConfig() as Record<string, ProxyOptions>;

    expect(Object.keys(proxy)).toEqual(Object.values(BILIBILI_UPSTREAMS).map(endpoint => endpoint.proxyPrefix));

    for (const endpoint of Object.values(BILIBILI_UPSTREAMS)) {
      const rule = proxy[endpoint.proxyPrefix];
      expect(rule.target).toBe(endpoint.origin);
      expect(rule.changeOrigin).toBe(true);
      expect(rule.secure).toBe(true);
      expect(rule.headers).toEqual(BILIBILI_WEB_PROXY_REQUEST_HEADERS);
      expect(rule.router).toBeUndefined();
      expect(rule.onProxyReq).toBeTypeOf("function");
      expect(rule.onProxyRes).toBeTypeOf("function");
    }
  });

  it("removes only the fixed prefix while preserving path and query", () => {
    const prefix = BILIBILI_UPSTREAMS.api.proxyPrefix;

    expect(rewriteBilibiliProxyPath(`${prefix}/x/web-interface/nav?foo=1&bar=2`, prefix)).toBe(
      "/x/web-interface/nav?foo=1&bar=2",
    );
    expect(rewriteBilibiliProxyPath(`${prefix}?foo=1`, prefix)).toBe("/?foo=1");
    expect(rewriteBilibiliProxyPath(prefix, prefix)).toBe("/");
  });

  it("overwrites the Bilibili identity headers and drops browser cookies", () => {
    const setHeader = vi.fn();
    const removeHeader = vi.fn();

    overwriteBilibiliProxyRequestHeaders({ setHeader, removeHeader } as Pick<
      ClientRequest,
      "removeHeader" | "setHeader"
    >);

    for (const [name, value] of Object.entries(BILIBILI_WEB_PROXY_REQUEST_HEADERS)) {
      expect(setHeader).toHaveBeenCalledWith(name, value);
    }
    expect(removeHeader).toHaveBeenCalledWith("cookie");
  });

  it("does not expose upstream Set-Cookie headers to the browser", () => {
    const headers: IncomingHttpHeaders = {
      "Set-Cookie": ["bili_jct=secret; Domain=.bilibili.com"],
      "content-type": "application/json",
      "set-cookie": ["SESSDATA=secret; Domain=.bilibili.com"],
    };

    stripBilibiliSetCookie(headers);

    expect(headers).toEqual({ "content-type": "application/json" });
  });
});
