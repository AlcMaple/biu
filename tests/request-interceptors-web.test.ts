import { describe, expect, it } from "vitest";

import { shouldCheckCookieRefresh } from "@/service/request/request-interceptors";

describe("request interceptor cookie refresh policy", () => {
  it("never starts Bilibili cookie refresh in anonymous Web sessions", () => {
    expect(shouldCheckCookieRefresh(true, undefined, 100)).toBe(false);
    expect(shouldCheckCookieRefresh(true, 1, 100)).toBe(false);
  });

  it("preserves the existing refresh schedule outside Web", () => {
    expect(shouldCheckCookieRefresh(false, undefined, 100)).toBe(true);
    expect(shouldCheckCookieRefresh(false, 99, 100)).toBe(true);
    expect(shouldCheckCookieRefresh(false, 100, 100)).toBe(false);
    expect(shouldCheckCookieRefresh(false, 101, 100)).toBe(false);
  });
});
