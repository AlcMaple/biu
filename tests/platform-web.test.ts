import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import webPlatform from "@/platform/web";
import { StoreNameMap } from "@shared/store";

const originalUserAgent = navigator.userAgent;

const setRuntime = (userAgent: string) => {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
};

const loadDetection = async () => {
  vi.resetModules();
  return import("@/platform/detect");
};

describe("platform detection", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalUserAgent });
  });

  it("detects Electron by user agent", async () => {
    setRuntime("Mozilla/5.0 Electron/38.6.0");

    await expect(loadDetection()).resolves.toMatchObject({ isElectron: true, isWeb: false });
  });

  it("keeps ordinary desktop and Android browsers on the Web platform", async () => {
    setRuntime("Mozilla/5.0 Chrome/140.0.0.0");
    await expect(loadDetection()).resolves.toMatchObject({ isElectron: false, isWeb: true });

    setRuntime("Mozilla/5.0 Linux; Android 16");
    await expect(loadDetection()).resolves.toMatchObject({ isElectron: false, isWeb: true });
  });
});

describe("Web platform adapter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists platform stores in browser storage", async () => {
    const settings = { appSettings: { fontFamily: "Biu" } } as never;

    await webPlatform.setStore(StoreNameMap.AppSettings, settings);

    await expect(webPlatform.getStore(StoreNameMap.AppSettings)).resolves.toEqual(settings);
    expect(localStorage.getItem("biu:app-settings")).toBe(JSON.stringify(settings));
  });

  it("未登录时本地歌单读出为空、写入丢弃，不落进共用存储", async () => {
    await webPlatform.setStore(StoreNameMap.LocalFavorites, { createdFavorites: [] } as never);

    await expect(webPlatform.getStore(StoreNameMap.LocalFavorites)).resolves.toBeUndefined();
    expect(localStorage.getItem("biu:local-favorites")).toBeNull();
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
