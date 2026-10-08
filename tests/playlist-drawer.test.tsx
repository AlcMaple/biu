/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks preserve hook names */
import React, { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  open: false,
  playId: 80,
  list: Array.from({ length: 100 }, (_, id) => ({ id, bvid: `BV${id}`, type: "mv" })),
  viewport: { clientHeight: 400, scrollHeight: 6400, scrollTo: vi.fn() },
  toast: vi.fn(),
}));
vi.mock("@heroui/react", () => ({
  addToast: state.toast,
  Drawer: ({ isOpen, children }: any) => (isOpen ? <>{children}</> : null),
  DrawerBody: ({ children }: any) => <>{children}</>,
  DrawerContent: ({ children }: any) => <>{children}</>,
  DrawerHeader: ({ children }: any) => <>{children}</>,
  Switch: () => null,
}));
vi.mock("@remixicon/react", () => ({ RiDeleteBinLine: () => null, RiFocus3Line: () => null }));
vi.mock("@/common/hooks/use-responsive", () => ({ useIsMobileLayout: () => false }));
vi.mock("@/common/utils/fav", () => ({ toPlaybackFavoriteModalData: vi.fn() }));
vi.mock("@/common/utils/url", () => ({ openBiliVideoLink: vi.fn() }));
vi.mock("@/platform", () => ({ default: {} }));
vi.mock("@/store/favorite", () => ({ useFavoritesStore: {} }));
vi.mock("@/store/local-fav-items", () => ({ useLocalFavItemsStore: {} }));
vi.mock("@/store/modal", () => ({ useModalStore: (select: any) => select({ isPlayListDrawerOpen: state.open }) }));
vi.mock("@/store/play-list", () => ({ usePlayList: (select: any) => select(state) }));
vi.mock("@/store/user", () => ({ useUser: (select: any) => select({}) }));
vi.mock("@/components/empty", () => ({ default: () => null }));
vi.mock("@/components/icon-button", () => ({
  default: ({ onPress, tooltip }: any) => (
    <button type="button" onClick={onPress}>
      {tooltip}
    </button>
  ),
}));
vi.mock("@/components/music-playlist-drawer/list-item", () => ({ default: () => null }));
vi.mock("@/components/virtual-list", () => ({
  VirtualList: ({ scrollRef }: any) => {
    useLayoutEffect(() => {
      scrollRef.current = { osInstance: () => ({ elements: () => ({ viewport: state.viewport }) }) };
      return () => {
        scrollRef.current = null;
      };
    }, [scrollRef]);
    return null;
  },
}));

import PlayListDrawer from "@/components/music-playlist-drawer";

let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const render = () => act(() => root.render(<PlayListDrawer />));
const flushFrame = () =>
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  state.open = false;
  state.playId = 80;
  state.viewport.clientHeight = 400;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

it("positions on every opening and follows playback changes while open", () => {
  render();
  state.open = true;
  render();
  flushFrame();
  expect(state.viewport.scrollTo).toHaveBeenLastCalledWith({ top: 5120, behavior: "instant" });
  state.playId = 90;
  render();
  flushFrame();
  expect(state.viewport.scrollTo).toHaveBeenCalledTimes(2);
  expect(state.viewport.scrollTo).toHaveBeenLastCalledWith({ top: 5760, behavior: "instant" });
  state.open = false;
  render();
  state.playId = 40;
  render();
  flushFrame();
  expect(state.viewport.scrollTo).toHaveBeenCalledTimes(2);
  state.open = true;
  render();
  flushFrame();
  expect(state.viewport.scrollTo).toHaveBeenLastCalledWith({ top: 2560, behavior: "instant" });
});

it("waits for layout and cancels pending positioning when closed", () => {
  state.viewport.clientHeight = 0;
  state.open = true;
  render();
  flushFrame();
  expect(state.viewport.scrollTo).not.toHaveBeenCalled();
  state.viewport.clientHeight = 400;
  flushFrame();
  expect(state.viewport.scrollTo).toHaveBeenCalledTimes(1);
  state.open = false;
  render();
  state.viewport.clientHeight = 0;
  state.open = true;
  render();
  flushFrame();
  state.open = false;
  render();
  expect(frames.size).toBe(0);
});

it("silently opens without a current song and preserves manual positioning", () => {
  state.playId = -1;
  state.open = true;
  render();
  flushFrame();
  expect(state.toast).not.toHaveBeenCalled();
  expect(state.viewport.scrollTo).not.toHaveBeenCalled();
  state.playId = 99;
  render();
  flushFrame();
  expect(state.viewport.scrollTo).toHaveBeenLastCalledWith({ top: 6000, behavior: "instant" });
  act(() => container.querySelector("button")!.click());
  expect(state.viewport.scrollTo).toHaveBeenLastCalledWith({ top: 6000, behavior: "smooth" });
});
