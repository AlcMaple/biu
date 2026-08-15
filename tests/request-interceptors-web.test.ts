import { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it, vi } from "vitest";

import { applyCsrfPolicy, requestInterceptors, shouldCheckCookieRefresh } from "@/service/request/request-interceptors";

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

  it("delegates CSRF injection to the BFF without exposing bili_jct in the renderer", async () => {
    const config = await requestInterceptors({
      data: { aid: 42 },
      headers: new AxiosHeaders(),
      method: "post",
      useCSRF: true,
      useFormData: true,
      url: "/x/example",
    } as InternalAxiosRequestConfig);

    expect(config.headers.get("X-Biu-Csrf")).toBe("inject");
    expect(config.headers.getContentType()).toBe("application/x-www-form-urlencoded");
    expect(config.data).toBeInstanceOf(URLSearchParams);
    expect(String(config.data)).toBe("aid=42");
    expect(String(config.data)).not.toContain("csrf");
  });

  it("keeps Blob/File payloads as multipart while retaining the server-side CSRF marker", async () => {
    const cover = new File(["cover"], "cover.png", { type: "image/png" });
    const config = await requestInterceptors({
      data: { cover, title: "test" },
      headers: new AxiosHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
      method: "post",
      useCSRF: true,
      useFormData: true,
      url: "/x/example-upload",
    } as InternalAxiosRequestConfig);

    expect(config.headers.get("X-Biu-Csrf")).toBe("inject");
    expect(config.headers.getContentType()).toBeUndefined();
    expect(config.data).toBeInstanceOf(FormData);
    expect(config.data.get("cover")).toBe(cover);
    expect(config.data.get("title")).toBe("test");
  });

  it("marks optional Web CSRF without requiring an anonymous session", async () => {
    const config = {
      data: { v_voucher: "voucher" },
      headers: new AxiosHeaders(),
      method: "post",
      useOptionalCSRF: true,
      url: "/x/gaia-vgate/v1/register",
    } as InternalAxiosRequestConfig;
    const readCookie = vi.fn();

    await applyCsrfPolicy(config, true, readCookie);

    expect(config.headers.get("X-Biu-Csrf")).toBe("inject-if-present");
    expect(readCookie).not.toHaveBeenCalled();
    expect(config.data).not.toHaveProperty("csrf");
  });

  it("injects optional CSRF for a signed-in desktop session", async () => {
    const config = {
      data: { v_voucher: "voucher" },
      headers: new AxiosHeaders(),
      method: "post",
      useOptionalCSRF: true,
      url: "/x/gaia-vgate/v1/register",
    } as InternalAxiosRequestConfig;

    await applyCsrfPolicy(config, false, vi.fn().mockResolvedValue("desktop-csrf"));

    expect(config.data).toEqual({ csrf: "desktop-csrf", v_voucher: "voucher" });
    expect(config.headers.get("X-Biu-Csrf")).toBeUndefined();
  });

  it("leaves optional CSRF absent for an anonymous desktop session", async () => {
    const config = {
      data: { v_voucher: "voucher" },
      headers: new AxiosHeaders(),
      method: "post",
      useOptionalCSRF: true,
      url: "/x/gaia-vgate/v1/register",
    } as InternalAxiosRequestConfig;

    await applyCsrfPolicy(config, false, vi.fn().mockResolvedValue(undefined));

    expect(config.data).toEqual({ v_voucher: "voucher" });
    expect(config.headers.get("X-Biu-Csrf")).toBeUndefined();
  });
});
