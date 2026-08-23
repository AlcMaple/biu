/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- module mocks must keep the production hook names */
import type { EffectCallback } from "react";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startupMocks = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  getCookitFromBSite: vi.fn<() => Promise<void>>(),
  initLocalPlaylistSync: vi.fn(),
  isWeb: true,
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  setUpdate: vi.fn(),
  updateUser: vi.fn<() => Promise<void>>(),
}));

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // 这些用例是直接调用组件函数而不是渲染，所以把用到的 hook 换成不依赖 renderer 的实现。
    useCallback: <T,>(callback: T) => callback,
    useEffect: (effect: EffectCallback) => {
      startupMocks.effects.push(effect);
    },
    useState: <T,>(initial: T) => [typeof initial === "function" ? (initial as () => T)() : initial, vi.fn()],
  };
});

vi.mock("react-router", async importOriginal => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useHref: vi.fn(),
    useLocation: () => ({ pathname: "/" }),
    useNavigate: () => vi.fn(),
    useRoutes: () => null,
  };
});

vi.mock("@heroui/react", () => ({
  HeroUIProvider: "div",
  ToastProvider: "div",
  useDisclosure: () => ({ isOpen: false, onClose: vi.fn(), onOpen: vi.fn(), onOpenChange: vi.fn() }),
}));

vi.mock("@/platform", () => ({
  default: {},
  get isWeb() {
    return startupMocks.isWeb;
  },
  isNativeMobile: false,
  log: startupMocks.log,
}));

// Layout 的响应式分支依赖 useSyncExternalStore；这些用例是直接调用组件函数而非渲染，
// 所以把断点 hook 固定为桌面形态。
vi.mock("@/common/hooks/use-responsive", () => ({
  useIsMobileLayout: () => false,
  useIsNarrowTabletLayout: () => false,
  useIsTabletLayout: () => false,
}));

vi.mock("@/common/utils/cookie", () => ({ getCookitFromBSite: startupMocks.getCookitFromBSite }));
vi.mock("@/service/sync", () => ({ initLocalPlaylistSync: startupMocks.initLocalPlaylistSync }));
vi.mock("@/store/user", () => ({ useUser: () => startupMocks.updateUser }));

vi.mock("@/components/confirm-modal", () => ({ default: "div" }));
vi.mock("@/components/error-fallback", () => ({ default: "div" }));
vi.mock("@/components/favorites-select-modal", () => ({ default: "div" }));
vi.mock("@/components/full-screen-player", () => ({ default: "div" }));
vi.mock("@/components/lyrics/broadcaster", () => ({ default: "div" }));
vi.mock("@/components/music-playlist-drawer", () => ({ default: "div" }));
vi.mock("@/components/release-note-modal", () => ({ default: "div" }));
vi.mock("@/components/theme", () => ({ default: "div" }));
vi.mock("@/components/video-pages-download-select-modal", () => ({ default: "div" }));
vi.mock("@/layout/navbar", () => ({ default: "div" }));
vi.mock("@/layout/playbar", () => ({ default: "div" }));
vi.mock("@/layout/side", () => ({ default: "div" }));
vi.mock("@/layout/side-drawer-context", () => ({ SideDrawerContext: { Provider: "div" } }));
vi.mock("@/routes", () => ({ default: [] }));
vi.mock("@/store/app-update", () => ({
  useAppUpdateStore: (selector: (state: { setUpdate: typeof startupMocks.setUpdate }) => unknown) =>
    selector({ setUpdate: startupMocks.setUpdate }),
}));
vi.mock("@/store/play-list", () => ({ usePlayList: { getState: vi.fn() } }));
vi.mock("@/store/play-progress", () => ({ usePlayProgress: { getState: vi.fn() } }));
vi.mock("@/store/shortcuts", () => ({ useShortcutSettings: { getState: vi.fn() } }));

import { App } from "@/app";
import Layout from "@/layout";

describe("renderer startup stability", () => {
  beforeEach(() => {
    startupMocks.effects.length = 0;
    startupMocks.isWeb = true;
  });

  it("does not seed Bilibili cookies for the anonymous Web session", () => {
    App();
    startupMocks.effects[0]?.();

    expect(startupMocks.getCookitFromBSite).not.toHaveBeenCalled();
  });

  it("records a failed native cookie seed without leaking a rejected promise", async () => {
    const error = new Error("cookie request failed");
    startupMocks.isWeb = false;
    startupMocks.getCookitFromBSite.mockRejectedValueOnce(error);

    App();
    startupMocks.effects[0]?.();
    await Promise.resolve();

    expect(startupMocks.log.warn).toHaveBeenCalledWith("[startup] 获取 B 站初始 Cookie 失败", error);
  });

  it("records a failed user refresh and skips the cookie-dependent sync loop on Web", async () => {
    const error = new Error("user request failed");
    startupMocks.updateUser.mockRejectedValueOnce(error);

    Layout();
    startupMocks.effects[0]?.();
    await Promise.resolve();

    expect(startupMocks.log.warn).toHaveBeenCalledWith("[startup] 更新用户信息失败", error);
    expect(startupMocks.initLocalPlaylistSync).not.toHaveBeenCalled();
  });

  it("keeps local playlist sync enabled outside ordinary Web", () => {
    startupMocks.isWeb = false;
    startupMocks.updateUser.mockResolvedValueOnce();

    Layout();
    startupMocks.effects[0]?.();

    expect(startupMocks.initLocalPlaylistSync).toHaveBeenCalledOnce();
  });
});

describe("Electron startup ordering", () => {
  it("installs request interceptors before the main window starts loading", async () => {
    const source = await readFile(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
    const readyStart = source.indexOf("app.whenReady().then");
    const ipcRegistration = source.indexOf("registerIpcHandlers", readyStart);
    const startupBlock = source.slice(readyStart, ipcRegistration);

    expect(startupBlock.indexOf("installWebRequestInterceptors();")).toBeLessThan(
      startupBlock.indexOf("createWindow();"),
    );
    expect(startupBlock).toContain("void injectAuthCookie().catch");
  });
});
