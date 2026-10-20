import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { create, type StoreApi, type UseBoundStore } from "zustand";

interface Item {
  id: string;
  bvid?: string;
  cid?: string;
  title: string;
  duration?: number;
}

const mocks = vi.hoisted(() => ({
  getStore: vi.fn(async () => ({})),
  setStore: vi.fn(),
  getPublishedLyrics: vi.fn(async () => ({ alignment: null, source: null })),
  autoMatchLyrics: vi.fn(async () => null),
}));

interface PlayListState {
  playId?: string;
  list: Item[];
  isPlaying: boolean;
  getPlayItem: () => Item | undefined;
}

const usePlayListMock = vi.hoisted(() => ({ store: undefined as unknown as UseBoundStore<StoreApi<PlayListState>> }));

vi.mock("@/store/play-list", () => {
  usePlayListMock.store = create<PlayListState>()((_set, get) => ({
    playId: undefined,
    list: [],
    isPlaying: true,
    getPlayItem: () => get().list.find(item => item.id === get().playId),
  }));
  return { audio: { paused: true, seeking: false, currentTime: 0 }, usePlayList: usePlayListMock.store };
});
vi.mock("@/platform", () => ({
  default: { getStore: mocks.getStore, setStore: mocks.setStore },
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/service/lyrics-align", () => ({ getPublishedLyrics: mocks.getPublishedLyrics }));
vi.mock("@/components/lyrics/auto-match", () => ({ AUTO_MATCH_VERSION: 2, autoMatchLyrics: mocks.autoMatchLyrics }));
vi.mock("@/pages/desktop-lyrics", () => ({ DESKTOP_LYRICS_CHANNEL: "test-desktop-lyrics" }));

import LyricsBroadcaster from "@/components/lyrics/broadcaster";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// 从搜索结果点播：先以无 cid 的状态切歌，取播放地址时才在同一个 playId 上补 cid
it("loads lyrics once the current track's cid is filled in after the switch", async () => {
  await act(async () => root.render(<LyricsBroadcaster />));
  await act(async () =>
    usePlayListMock.store.setState({ playId: "a", list: [{ id: "a", bvid: "BV1za41197Y9", title: "背对背拥抱" }] }),
  );
  expect(mocks.getStore).not.toHaveBeenCalled();

  await act(async () =>
    usePlayListMock.store.setState({
      list: [{ id: "a", bvid: "BV1za41197Y9", cid: "813345505", title: "背对背拥抱", duration: 236 }],
    }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(2000));

  expect(mocks.getPublishedLyrics).toHaveBeenCalledWith("BV1za41197Y9", "813345505");
  expect(mocks.autoMatchLyrics).toHaveBeenCalledWith("背对背拥抱", 236, expect.any(Function));
});
