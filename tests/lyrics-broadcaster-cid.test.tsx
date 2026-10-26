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
  getRecognizedLyrics: vi.fn<() => Promise<AlignRecognized>>(),
  putRecognizedLyrics: vi.fn(async () => ({ stored: true })),
  autoMatchLyrics:
    vi.fn<
      (
        title: string,
        duration?: number,
        isCanceled?: () => boolean,
        outcome?: { exhausted: boolean },
      ) => Promise<AutoLyricsResult | null>
    >(),
  autoAlign: vi.fn(),
  searchNeteaseSongs: vi.fn<(params: SearchSongByNeteaseParams) => Promise<SearchSongByNeteaseResponse>>(),
  getNeteaseLyrics: vi.fn<(params: GetLyricsByNeteaseParams) => Promise<GetLyricsByNeteaseResponse>>(),
  searchLrclibLyrics: vi.fn(async () => []),
  getAiSubtitle: vi.fn<() => Promise<import("@/service/ai-subtitle").AiSubtitleOutcome>>(),
  createScreenJob: vi.fn<() => Promise<ScreenJobView>>(),
  getScreenJob: vi.fn<() => Promise<ScreenJobView>>(),
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
vi.mock("@/service/lyrics-align", () => ({
  getPublishedLyrics: mocks.getPublishedLyrics,
  getRecognizedLyrics: mocks.getRecognizedLyrics,
  putRecognizedLyrics: mocks.putRecognizedLyrics,
  createScreenJob: mocks.createScreenJob,
  getScreenJob: mocks.getScreenJob,
  AlignApiError: class extends Error {},
}));
vi.mock("@/service/ai-subtitle", () => ({ getAiSubtitle: mocks.getAiSubtitle }));
const userMock = vi.hoisted(() => ({ user: { mid: 1 } as unknown }));
vi.mock("@/store/user", () => ({ useUser: { getState: () => ({ user: userMock.user }) } }));
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
  mocks.getRecognizedLyrics.mockResolvedValue({ recognized: null, missingUntil: null, v: null });
  mocks.putRecognizedLyrics.mockClear();
  mocks.getAiSubtitle.mockResolvedValue({ kind: "none" });
  userMock.user = { mid: 1 };
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
  expect(mocks.autoMatchLyrics).toHaveBeenCalledWith("背对背拥抱", 236, expect.any(Function), expect.anything());
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

const login = hit;
it("uses lyrics already recognized by someone else, without matching or re-reporting", async () => {
  mocks.getRecognizedLyrics.mockResolvedValue({
    recognized: { lyrics: hit.lyrics, tLyrics: null, from: "qq" },
    missingUntil: null,
    v: AUTO_MATCH_VERSION,
  });
  await act(async () => root.render(<LyricsBroadcaster />));
  const item = track();
  await select(item);
  await advance();

  expect(mocks.autoMatchLyrics).not.toHaveBeenCalled();
  expect(mocks.putRecognizedLyrics).not.toHaveBeenCalled();
  expect(cache[cacheKey(item)]).toMatchObject({ lyrics: hit.lyrics, source: "auto", autoVersion: AUTO_MATCH_VERSION });
  expect(mocks.autoAlign).toHaveBeenCalled();
});

it("ignores recognized lyrics from an older matching version and matches again", async () => {
  mocks.getRecognizedLyrics.mockResolvedValue({
    recognized: { lyrics: "[00:00.00]旧", tLyrics: null, from: "qq" },
    missingUntil: null,
    v: AUTO_MATCH_VERSION - 1,
  });
  mocks.autoMatchLyrics.mockResolvedValue(login);
  await act(async () => root.render(<LyricsBroadcaster />));
  await select(track());
  await advance();

  expect(mocks.autoMatchLyrics).toHaveBeenCalledTimes(1);
  expect(mocks.putRecognizedLyrics).toHaveBeenCalledWith(
    expect.objectContaining({ v: AUTO_MATCH_VERSION, lyrics: hit.lyrics, from: "netease" }),
  );
});

it("skips matching when the server says no channel has this song", async () => {
  mocks.getRecognizedLyrics.mockResolvedValue({
    recognized: null,
    missingUntil: Date.now() + 60_000,
    v: AUTO_MATCH_VERSION,
  });
  await act(async () => root.render(<LyricsBroadcaster />));
  await select(track());
  await advance();

  expect(mocks.autoMatchLyrics).not.toHaveBeenCalled();
  expect(useLyricsState.getState().lyrics).toEqual([]);
});

it("reports a miss for non-tianci videos without recognizing the video frames", async () => {
  mocks.autoMatchLyrics.mockImplementation(async (_t, _d, _c, outcome) => {
    if (outcome) outcome.exhausted = true;
    return null;
  });
  await act(async () => root.render(<LyricsBroadcaster />));
  const item = track();
  await select(item);
  await advance();
  expect(mocks.putRecognizedLyrics).toHaveBeenCalledExactlyOnceWith({
    bvid: item.bvid,
    cid: item.cid,
    v: AUTO_MATCH_VERSION,
    missing: true,
  });
  expect(mocks.getAiSubtitle).not.toHaveBeenCalled();
  expect(mocks.createScreenJob).not.toHaveBeenCalled();

  mocks.putRecognizedLyrics.mockClear();
  mocks.autoMatchLyrics.mockResolvedValue(null);
  await select(track());
  await advance();
  expect(mocks.putRecognizedLyrics).not.toHaveBeenCalled();
});

it("still matches locally when the server lookup fails", async () => {
  mocks.getRecognizedLyrics.mockRejectedValue(new Error("down"));
  mocks.autoMatchLyrics.mockResolvedValue(hit);
  await act(async () => root.render(<LyricsBroadcaster />));
  const item = track();
  await select(item);
  await advance();
  expect(cache[cacheKey(item)]).toMatchObject({ lyrics: hit.lyrics });
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
  expect(mocks.autoMatchLyrics).toHaveBeenCalledExactlyOnceWith(b.title, 180, expect.any(Function), expect.anything());
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

it("keeps manually adopted lyrics even when the server has a published version", async () => {
  const item = track();
  cache[cacheKey(item)] = { lyrics: "[00:00.00]手动选择", source: "manual" };
  mocks.getPublishedLyrics.mockResolvedValue({
    alignment: { lyricsHash: "h", lines: [{ time: 0, text: "生效版本", words: [] }] },
    source: "approved",
  } as never);
  await act(async () => root.render(<LyricsBroadcaster />));
  await select(item);
  await advance();

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

const SUBTITLE = [{ from: 1, to: 3, content: "字幕第一句" }];
const SCREEN_LRC = "[00:01.00]画面第一句\n[00:04.00]画面第二句\n[00:07.00]画面第三句";

it("skips title search for tianci songs and uses lyrics recognized from the video frames", async () => {
  mocks.getAiSubtitle.mockResolvedValue({ kind: "ok", lines: SUBTITLE });
  mocks.createScreenJob.mockResolvedValue({ id: "job", state: "queued", position: 1 });
  mocks.getScreenJob.mockResolvedValue({ id: "job", state: "done" });
  mocks.getRecognizedLyrics.mockResolvedValueOnce({ recognized: null, missingUntil: null, v: null }).mockResolvedValue({
    recognized: { lyrics: SCREEN_LRC, tLyrics: null, from: "screen", confident: false },
    missingUntil: null,
    v: AUTO_MATCH_VERSION,
  });
  await act(async () => root.render(<LyricsBroadcaster />));
  const item = { ...track(), title: "【原神】欧气分你一半（原曲：xxx）" };
  await select(item);
  await advance(2000);
  expect(useLyricsState.getState().screenStatus).toEqual({ kind: "working" });
  await advance(4000);

  expect(mocks.autoMatchLyrics).not.toHaveBeenCalled();
  expect(mocks.createScreenJob).toHaveBeenCalledWith({
    bvid: item.bvid,
    cid: item.cid,
    v: AUTO_MATCH_VERSION,
    subtitle: SUBTITLE,
  });
  expect(useLyricsState.getState().lyrics.map(l => l.text)).toEqual(["画面第一句", "画面第二句", "画面第三句"]);
  expect(useLyricsState.getState().screenStatus).toBeNull();
  expect(useLyricsState.getState().screenOrigin).toEqual({
    kind: "screen-unsure",
    text: "画面第一句画面第二句画面第三句",
  });
  expect(cache[cacheKey(item)]).toMatchObject({ lyrics: SCREEN_LRC, screenOrigin: { kind: "screen-unsure" } });
  // 结果服务端已经存了，不再上报；照常自动对齐
  expect(mocks.putRecognizedLyrics).not.toHaveBeenCalled();
  expect(mocks.autoAlign).toHaveBeenLastCalledWith(SCREEN_LRC, { userChosen: false });
});

it("recognizes tianci videos without an AI subtitle from the frames alone, keeping the translation", async () => {
  mocks.getAiSubtitle.mockResolvedValue({ kind: "none" });
  mocks.createScreenJob.mockResolvedValue({ id: "job", state: "done" });
  mocks.getRecognizedLyrics.mockResolvedValueOnce({ recognized: null, missingUntil: null, v: null }).mockResolvedValue({
    recognized: {
      lyrics: "[00:01.00]I let you go\n[00:04.00]Walked away\n[00:07.00]Now",
      tLyrics: "[00:01.00]那时我放开了的手\n[00:04.00]转过身只剩了保重",
      from: "screen",
      confident: false,
    },
    missingUntil: null,
    v: AUTO_MATCH_VERSION,
  });
  await act(async () => root.render(<LyricsBroadcaster />));
  const item = { ...track(), title: "徐良《坏女孩》，但是英文填词" };
  await select(item);
  await advance(6000);

  expect(mocks.createScreenJob).toHaveBeenCalledWith({
    bvid: item.bvid,
    cid: item.cid,
    v: AUTO_MATCH_VERSION,
    subtitle: [],
  });
  expect(mocks.putRecognizedLyrics).not.toHaveBeenCalled();
  expect(useLyricsState.getState().lyrics.map(l => l.text)).toEqual(["I let you go", "Walked away", "Now"]);
  expect(useLyricsState.getState().translatedLyrics.map(l => l.text)).toEqual(["那时我放开了的手", "转过身只剩了保重"]);
  expect(cache[cacheKey(item)]).toMatchObject({ tLyrics: "[00:01.00]那时我放开了的手\n[00:04.00]转过身只剩了保重" });
});

it("tells logged-out users that tianci recognition needs login, without requesting anything", async () => {
  userMock.user = undefined;
  await act(async () => root.render(<LyricsBroadcaster />));
  await select({ ...track(), title: "【填词】某某" });
  await advance();

  expect(mocks.getAiSubtitle).not.toHaveBeenCalled();
  expect(useLyricsState.getState().screenStatus).toEqual({
    kind: "failed",
    message: "登录后可自动识别填词歌歌词。",
  });
});

it("shows the server's specific reason when recognition fails, and does not retry", async () => {
  mocks.getAiSubtitle.mockResolvedValue({ kind: "ok", lines: SUBTITLE });
  mocks.createScreenJob.mockResolvedValue({
    id: "job",
    state: "failed",
    error: { code: "VIDEO_PCDN_ONLY", message: "视频画面下载失败，暂时无法识别歌词。" },
  });
  await act(async () => root.render(<LyricsBroadcaster />));
  await select({ ...track(), title: "【填词】某某" });
  await advance(10000);

  expect(mocks.createScreenJob).toHaveBeenCalledTimes(1);
  expect(useLyricsState.getState().screenStatus).toEqual({
    kind: "failed",
    message: "视频画面下载失败，暂时无法识别歌词。",
  });
});

it("maps rate limiting to the dedicated message", async () => {
  mocks.getAiSubtitle.mockResolvedValue({ kind: "rate-limited" });
  await act(async () => root.render(<LyricsBroadcaster />));
  await select({ ...track(), title: "【填词】某某" });
  await advance();
  expect(useLyricsState.getState().screenStatus).toEqual({ kind: "failed", message: "识别请求太频繁，请稍后再试。" });
});
