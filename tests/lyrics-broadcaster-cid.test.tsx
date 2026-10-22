import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { create, type StoreApi, type UseBoundStore } from "zustand";

import type { AutoLyricsResult } from "@/components/lyrics/auto-match";

import searches from "./fixtures/lyrics-auto-match-search.json";

interface Item {
  id: string;
  bvid?: string;
  cid?: string;
  title: string;
  duration?: number;
}

const mocks = vi.hoisted(() => ({
  getStore: vi.fn<() => Promise<Record<string, MusicLyrics>>>(),
  setStore: vi.fn<(name: string, value: Record<string, MusicLyrics>) => Promise<void>>(),
  getPublishedLyrics: vi.fn(async () => ({ alignment: null, source: null })),
  autoMatchLyrics:
    vi.fn<(title: string, duration?: number, isCanceled?: () => boolean) => Promise<AutoLyricsResult | null>>(),
  autoAlign: vi.fn(),
  searchNeteaseSongs: vi.fn<(params: SearchSongByNeteaseParams) => Promise<SearchSongByNeteaseResponse>>(),
  getNeteaseLyrics: vi.fn<(params: GetLyricsByNeteaseParams) => Promise<GetLyricsByNeteaseResponse>>(),
  searchLrclibLyrics: vi.fn(async () => []),
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
  default: {
    getStore: mocks.getStore,
    setStore: mocks.setStore,
    searchNeteaseSongs: mocks.searchNeteaseSongs,
    getNeteaseLyrics: mocks.getNeteaseLyrics,
    searchLrclibLyrics: mocks.searchLrclibLyrics,
  },
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/service/lyrics-align", () => ({ getPublishedLyrics: mocks.getPublishedLyrics }));
vi.mock("@/components/lyrics/auto-match", async importOriginal => ({
  ...(await importOriginal<typeof import("@/components/lyrics/auto-match")>()),
  autoMatchLyrics: mocks.autoMatchLyrics,
}));
vi.mock("@/store/lyrics-align-session", () => ({
  alignInputOf: (entry?: MusicLyrics) => entry?.lyrics ?? "",
  useLyricsAlignSession: { getState: () => ({ auto: mocks.autoAlign }) },
}));
vi.mock("@/pages/desktop-lyrics", () => ({ DESKTOP_LYRICS_CHANNEL: "test-desktop-lyrics" }));

import { AUTO_MATCH_VERSION } from "@/components/lyrics/auto-match";
import LyricsBroadcaster from "@/components/lyrics/broadcaster";
import { useLyricsState } from "@/store/lyrics-state";

class TestChannel {
  static current: TestChannel;
  listeners = new Set<(event: MessageEvent) => void>();
  postMessage = vi.fn();
  close = vi.fn();
  constructor() {
    TestChannel.current = this;
  }
  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener);
  }
  request() {
    for (const listener of this.listeners) listener(new MessageEvent("message", { data: { type: "request" } }));
  }
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const hit: AutoLyricsResult = { lyrics: "[00:00.00]当前歌曲\n[00:04.00]下一行\n[00:08.00]最后一行", from: "netease" };
let sequence = 0;
const track = (): Item => ({
  id: `track-${++sequence}`,
  bvid: `BV-fixture-${sequence}`,
  cid: String(sequence),
  title: `歌曲${sequence}`,
  duration: 180,
});
const cacheKey = (item: Item) => `${item.bvid}-${item.cid}`;
const select = async (item: Item) => {
  await act(async () => usePlayListMock.store.setState({ playId: item.id, list: [item] }));
};
const advance = async (ms = 2000) => {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
};

let root: Root;
let host: HTMLDivElement;
let cache: Record<string, MusicLyrics>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("BroadcastChannel", TestChannel);
  usePlayListMock.store.setState({ playId: undefined, list: [], isPlaying: true });
  useLyricsState.getState().reset();
  cache = {};
  mocks.getStore.mockImplementation(async () => cache);
  mocks.setStore.mockImplementation(async (_name, value) => {
    cache = value;
  });
  mocks.autoMatchLyrics.mockResolvedValue(null);
  mocks.getPublishedLyrics.mockResolvedValue({ alignment: null, source: null });
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

it("matches and broadcasts lyrics with no lyrics panel mounted", async () => {
  mocks.autoMatchLyrics.mockResolvedValue(hit);
  await act(async () => root.render(<LyricsBroadcaster />));
  const item = track();
  await select(item);
  await advance();

  expect(useLyricsState.getState().lyrics[0].text).toBe("当前歌曲");
  expect(TestChannel.current.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "update", lines: useLyricsState.getState().lyrics, activeIndex: 0 }),
  );
  expect(cache[cacheKey(item)]).toMatchObject({ lyrics: hit.lyrics, source: "auto" });
});

it("sends the current snapshot when the desktop lyrics window reopens", async () => {
  mocks.autoMatchLyrics.mockResolvedValue(hit);
  await act(async () => root.render(<LyricsBroadcaster />));
  await select(track());
  await advance();
  TestChannel.current.postMessage.mockClear();

  await act(async () => TestChannel.current.request());

  expect(TestChannel.current.postMessage).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      type: "update",
      lines: useLyricsState.getState().lyrics,
      activeIndex: 0,
      isPlaying: true,
    }),
  );
  expect(mocks.autoMatchLyrics).toHaveBeenCalledTimes(1);
});

it("clears the previous lyrics while the next track's cache is loading", async () => {
  const a = track();
  const b = track();
  cache[cacheKey(a)] = { lyrics: "[00:00.00]上一首", source: "manual" };
  await act(async () => root.render(<LyricsBroadcaster />));
  await select(a);
  expect(useLyricsState.getState().lyrics[0].text).toBe("上一首");
  const loading = deferred<Record<string, MusicLyrics>>();
  mocks.getStore.mockReturnValueOnce(loading.promise);
  await select(b);

  expect(useLyricsState.getState().lyrics).toEqual([]);
  expect(TestChannel.current.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ lines: [] }));
  await act(async () => loading.resolve({ [cacheKey(b)]: { lyrics: "[00:00.00]下一首", source: "manual" } }));
  expect(useLyricsState.getState().lyrics[0].text).toBe("下一首");
});

it("does not send matching requests for tracks skipped during the debounce", async () => {
  await act(async () => root.render(<LyricsBroadcaster />));
  const a = track();
  await select(a);
  await advance(1000);
  const b = track();
  await select(b);
  await advance(1000);
  expect(mocks.autoMatchLyrics).not.toHaveBeenCalled();
  await advance(600);
  expect(mocks.autoMatchLyrics).toHaveBeenCalledExactlyOnceWith(b.title, 180, expect.any(Function));
});

it("matches again when returning to a track whose in-flight match was canceled", async () => {
  const pending = deferred<AutoLyricsResult | null>();
  mocks.autoMatchLyrics.mockReturnValueOnce(pending.promise).mockResolvedValue(hit);
  await act(async () => root.render(<LyricsBroadcaster />));
  const a = track();
  await select(a);
  await advance();
  const isCanceled = mocks.autoMatchLyrics.mock.calls[0][2];
  await select(track());
  await select(a);
  await act(async () => pending.resolve(null));
  await advance();

  expect(isCanceled?.()).toBe(true);
  expect(mocks.autoMatchLyrics).toHaveBeenCalledTimes(2);
  expect(useLyricsState.getState().lyrics[0]?.text).toBe("当前歌曲");
});

it("does not mark a canceled cache reread as a completed match", async () => {
  mocks.autoMatchLyrics.mockResolvedValue(hit);
  const reread = deferred<Record<string, MusicLyrics>>();
  mocks.getStore.mockResolvedValueOnce({}).mockReturnValueOnce(reread.promise);
  await act(async () => root.render(<LyricsBroadcaster />));
  const a = track();
  await select(a);
  await advance();
  await select(track());
  await select(a);
  await act(async () => reread.resolve({}));
  await advance();

  expect(mocks.autoMatchLyrics).toHaveBeenCalledTimes(2);
  expect(useLyricsState.getState().lyrics[0]?.text).toBe("当前歌曲");
});

it("does not align the previous track's lyrics after a slow cache write", async () => {
  const writing = deferred<void>();
  mocks.autoMatchLyrics.mockResolvedValue(hit);
  mocks.setStore.mockReturnValueOnce(writing.promise);
  await act(async () => root.render(<LyricsBroadcaster />));
  await select(track());
  await advance();
  expect(mocks.setStore).toHaveBeenCalledTimes(1);
  await select(track());
  await act(async () => writing.resolve());

  expect(mocks.autoAlign).not.toHaveBeenCalled();
  expect(useLyricsState.getState().lyrics).toEqual([]);
});

it("still loads lyrics when returning while an earlier successful cache write finishes", async () => {
  const writing = deferred<void>();
  const published = deferred<{ alignment: null; source: null }>();
  mocks.autoMatchLyrics.mockResolvedValue(hit);
  mocks.setStore.mockImplementationOnce(async (_name, value) => {
    await writing.promise;
    cache = value;
  });
  await act(async () => root.render(<LyricsBroadcaster />));
  const a = track();
  await select(a);
  await advance();
  await select(track());
  mocks.getPublishedLyrics.mockReturnValueOnce(published.promise);
  await select(a);
  await act(async () => writing.resolve());
  await act(async () => published.resolve({ alignment: null, source: null }));
  await advance();

  expect(useLyricsState.getState().lyrics[0]?.text).toBe("当前歌曲");
});

it("keeps completed misses from repeatedly requesting on revisits", async () => {
  await act(async () => root.render(<LyricsBroadcaster />));
  const a = track();
  await select(a);
  await advance();
  await select(track());
  await select(a);
  await advance();

  expect(mocks.autoMatchLyrics).toHaveBeenCalledTimes(1);
  expect(useLyricsState.getState().isLoading).toBe(false);
});

it("preserves manual lyrics adopted while automatic matching is in flight", async () => {
  const pending = deferred<AutoLyricsResult | null>();
  mocks.autoMatchLyrics.mockReturnValueOnce(pending.promise);
  await act(async () => root.render(<LyricsBroadcaster />));
  const a = track();
  await select(a);
  await advance();
  cache[cacheKey(a)] = { lyrics: "[00:00.00]手动选择", source: "manual" };
  await act(async () => useLyricsState.getState().setLyrics([{ time: 0, text: "手动选择" }]));
  await act(async () => pending.resolve(hit));

  expect(useLyricsState.getState().lyrics[0].text).toBe("手动选择");
  expect(mocks.setStore).not.toHaveBeenCalled();
});

it.each(["manual", "aligned", undefined] as const)(
  "preserves existing user-chosen lyrics (%s) on matcher upgrades",
  async source => {
    const item = track();
    cache[cacheKey(item)] = { lyrics: "[00:00.00]用户选择", source, autoVersion: 1 };
    await act(async () => root.render(<LyricsBroadcaster />));
    await select(item);
    await advance();
    expect(useLyricsState.getState().lyrics[0].text).toBe("用户选择");
    expect(mocks.autoMatchLyrics).not.toHaveBeenCalled();
    expect(mocks.setStore).not.toHaveBeenCalled();
  },
);

it.each([
  ["邪神酱 / 神保町哀歌 完整版 （CV： 铃木爱奈 ）", 607, 1439125412],
  ["冰之城墙 ED主题歌 逆様", 172, 3367822213],
] as const)(
  "runs real matching through the broadcaster, cache and desktop broadcast: %s",
  async (title, duration, id) => {
    const real = await vi.importActual<typeof import("@/components/lyrics/auto-match")>(
      "@/components/lyrics/auto-match",
    );
    mocks.autoMatchLyrics.mockImplementation(real.autoMatchLyrics);
    const results: Record<string, NeteaseSong[]> = searches;
    mocks.searchNeteaseSongs.mockImplementation(async ({ s }) => ({ result: { songs: results[s] ?? [] } }));
    mocks.getNeteaseLyrics.mockResolvedValue({ lrc: { lyric: hit.lyrics } });
    const item = { ...track(), title, duration };
    cache[cacheKey(item)] = { lyrics: "[00:00.00]旧自动缓存", source: "auto", autoVersion: AUTO_MATCH_VERSION - 1 };
    await act(async () => root.render(<LyricsBroadcaster />));
    await select(item);
    await advance(10000);

    expect(mocks.getNeteaseLyrics).toHaveBeenCalledExactlyOnceWith({ id });
    expect(cache[cacheKey(item)]).toMatchObject({
      lyrics: hit.lyrics,
      source: "auto",
      autoVersion: AUTO_MATCH_VERSION,
    });
    expect(useLyricsState.getState().lyrics[0].text).toBe("当前歌曲");
    expect(TestChannel.current.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ lines: useLyricsState.getState().lyrics }),
    );
    expect(mocks.autoAlign).toHaveBeenLastCalledWith(hit.lyrics, { userChosen: false });
  },
);
