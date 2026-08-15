import { describe, expect, it } from "vitest";

import { BILIBILI_UPSTREAMS, resolveBilibiliBaseURL } from "@shared/bilibili-web-proxy";

import { createBilibiliWebMiddleware } from "../plugins/bilibili-web-proxy";

describe("Bilibili Web middleware", () => {
  it("uses fixed same-origin prefixes only for Web", () => {
    for (const [name, endpoint] of Object.entries(BILIBILI_UPSTREAMS)) {
      expect(resolveBilibiliBaseURL(name as keyof typeof BILIBILI_UPSTREAMS, true)).toBe(endpoint.proxyPrefix);
      expect(resolveBilibiliBaseURL(name as keyof typeof BILIBILI_UPSTREAMS, false)).toBe(endpoint.origin);
    }
  });

  it("exposes one reusable middleware instead of configurable target proxy rules", () => {
    expect(createBilibiliWebMiddleware()).toBeTypeOf("function");
  });
});
