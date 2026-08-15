import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import webPlatform from "@/platform/web";
import { StoreNameMap } from "@shared/store";

const originalUserAgent = navigator.userAgent;
const originalCapacitor = Reflect.get(globalThis, "Capacitor");

const setRuntime = (userAgent: string, platform?: "android" | "ios" | "web", native = false) => {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
  if (platform) {
    Reflect.set(globalThis, "Capacitor", {
      getPlatform: () => platform,
      isNativePlatform: () => native,
    });
  } else {
    Reflect.deleteProperty(globalThis, "Capacitor");
  }
};

const loadDetection = async () => {
  vi.resetModules();
  return import("@/platform/detect");
};

describe("platform detection", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalUserAgent });
    if (originalCapacitor === undefined) Reflect.deleteProperty(globalThis, "Capacitor");
    else Reflect.set(globalThis, "Capacitor", originalCapacitor);
  });

  it("detects Electron before considering a Capacitor bridge", async () => {
    setRuntime("Mozilla/5.0 Electron/38.6.0", "android", true);

    await expect(loadDetection()).resolves.toMatchObject({
      isElectron: true,
      isAndroid: false,
      isIOS: false,
      isNativeMobile: false,
      isWeb: false,
    });
  });

  it("detects only a native Capacitor Android runtime as Android", async () => {
    setRuntime("Mozilla/5.0 Linux; Android 16", "android", true);

    await expect(loadDetection()).resolves.toMatchObject({
      isElectron: false,
      isAndroid: true,
      isIOS: false,
      isNativeMobile: true,
      isWeb: false,
    });
  });

  it("detects native Capacitor iOS without classifying it as Web or Android", async () => {
    setRuntime("Mozilla/5.0 iPhone", "ios", true);

    await expect(loadDetection()).resolves.toMatchObject({
      isElectron: false,
      isAndroid: false,
      isIOS: true,
      isNativeMobile: true,
      isWeb: false,
    });
  });

  it("keeps ordinary desktop and Android browsers on the Web platform", async () => {
    setRuntime("Mozilla/5.0 Chrome/140.0.0.0");
    await expect(loadDetection()).resolves.toMatchObject({
      isElectron: false,
      isAndroid: false,
      isIOS: false,
      isNativeMobile: false,
      isWeb: true,
    });

    setRuntime("Mozilla/5.0 Linux; Android 16", "web", false);
    await expect(loadDetection()).resolves.toMatchObject({
      isElectron: false,
      isAndroid: false,
      isIOS: false,
      isNativeMobile: false,
      isWeb: true,
    });
  });
});

describe("Web platform adapter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists platform stores in browser storage", async () => {
    const favorites = { "-1": [{ id: 1, title: "Biu" }] };

    await webPlatform.setStore(StoreNameMap.LocalFavorites, favorites);

    await expect(webPlatform.getStore(StoreNameMap.LocalFavorites)).resolves.toEqual(favorites);
    expect(localStorage.getItem("biu:local-favorites")).toBe(JSON.stringify(favorites));

    await webPlatform.clearStore(StoreNameMap.LocalFavorites);
    await expect(webPlatform.getStore(StoreNameMap.LocalFavorites)).resolves.toBeUndefined();
  });

  it("opens only HTTP links with opener isolation", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await expect(webPlatform.openExternal("https://www.bilibili.com")).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith("https://www.bilibili.com/", "_blank", "noopener,noreferrer");

    open.mockClear();
    await expect(webPlatform.openExternal("javascript:alert(1)")).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("uses safe no-op results for native-only file capabilities", async () => {
    await expect(webPlatform.selectDirectory()).resolves.toBeNull();
    await expect(webPlatform.scanLocalMusic([])).resolves.toEqual([]);
    await expect(webPlatform.deleteLocalMusicFile("/tmp/song.mp3")).resolves.toBe(false);
  });
});
