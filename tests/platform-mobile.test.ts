import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreNameMap } from "@shared/store";

const mocks = vi.hoisted(() => ({
  getPreference: vi.fn(),
  setPreference: vi.fn(),
  removePreference: vi.fn(),
  getCookies: vi.fn(),
  setCookie: vi.fn(),
  httpRequest: vi.fn(),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: mocks.getPreference,
    set: mocks.setPreference,
    remove: mocks.removePreference,
  },
}));

vi.mock("@capacitor/core", () => ({
  CapacitorCookies: {
    getCookies: mocks.getCookies,
    setCookie: mocks.setCookie,
  },
  CapacitorHttp: {
    request: mocks.httpRequest,
  },
}));

const originalCapacitor = Reflect.get(globalThis, "Capacitor");

const setNativePlatform = (platform: "android" | "ios") => {
  Reflect.set(globalThis, "Capacitor", {
    getPlatform: () => platform,
    isNativePlatform: () => true,
  });
};

describe("native mobile platform adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    setNativePlatform("ios");
  });

  afterEach(() => {
    if (originalCapacitor === undefined) Reflect.deleteProperty(globalThis, "Capacitor");
    else Reflect.set(globalThis, "Capacitor", originalCapacitor);
  });

  it("uses Capacitor Preferences and reports the iOS platform", async () => {
    mocks.getPreference.mockResolvedValue({ value: '{"theme":"dark"}' });
    const { default: platform } = await import("@/platform/mobile");

    expect(platform.getPlatform()).toBe("ios");
    await expect(platform.getStore(StoreNameMap.AppSettings)).resolves.toEqual({ theme: "dark" });
    expect(mocks.getPreference).toHaveBeenCalledWith({ key: "biu:app-settings" });

    await platform.setStore(StoreNameMap.AppSettings, { theme: "light" } as never);
    expect(mocks.setPreference).toHaveBeenCalledWith({ key: "biu:app-settings", value: '{"theme":"light"}' });

    await platform.clearStore(StoreNameMap.AppSettings);
    expect(mocks.removePreference).toHaveBeenCalledWith({ key: "biu:app-settings" });
  });

  it("uses Capacitor Cookies for the shared Bilibili login state", async () => {
    mocks.getCookies.mockResolvedValue({ SESSDATA: "session-value" });
    const { default: platform } = await import("@/platform/mobile");

    await expect(platform.getCookie("SESSDATA")).resolves.toBe("session-value");
    await platform.setCookie("SESSDATA", "next-value", 1_800_000_000);

    expect(mocks.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://www.bilibili.com",
        key: "SESSDATA",
        value: "next-value",
      }),
    );
  });

  it("uses the native HTTP bridge with an iOS user agent", async () => {
    mocks.httpRequest.mockResolvedValue({ data: { code: 0 } });
    const { default: http } = await import("@/platform/http-native");

    await expect(http.request({ url: "https://api.bilibili.com/x/web-interface/nav" })).resolves.toEqual({ code: 0 });
    expect(mocks.httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: "https://www.bilibili.com",
          "User-Agent": expect.stringContaining("iPhone"),
        }),
      }),
    );
  });
});
