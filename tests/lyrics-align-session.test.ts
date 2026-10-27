import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";

const h = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  createAlignJob: vi.fn(),
  getAlignJob: vi.fn(),
  getAlignDraft: vi.fn(),
  discardAlignDraft: vi.fn(),
  publishAlignment: vi.fn(),
  realignByHash: vi.fn(),
  isLogin: true,
  isAdmin: false,
}));

vi.mock("@heroui/react", () => ({ addToast: vi.fn() }));

vi.mock("@/platform", () => ({
  default: {
    getStore: vi.fn(async (name: string) => h.store[name]),
    setStore: vi.fn(async (name: string, value: unknown) => {
      h.store[name] = JSON.parse(JSON.stringify(value));
    }),
  },
  log: { info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/service/lyrics-align", () => ({
  AlignApiError: class extends Error {},
  createAlignJob: h.createAlignJob,
  getAlignJob: h.getAlignJob,
  getAlignDraft: h.getAlignDraft,
  discardAlignDraft: h.discardAlignDraft,
  publishAlignment: h.publishAlignment,
  realignByHash: h.realignByHash,
}));

vi.mock("@/store/align-review", () => ({
  useAlignReview: { getState: () => ({ isAdmin: h.isAdmin, refresh: vi.fn() }) },
}));

vi.mock("@/store/user", () => ({
  useUser: { getState: () => ({ user: { isLogin: h.isLogin } }) },
}));

vi.mock("@/store/play-list", () => {
  type Item = { id: string; bvid: string; cid: string; title: string; source?: string };
  const usePlayList = create<{ playId: string; list: Item[]; getPlayItem: () => Item | undefined }>((_set, get) => ({
    playId: "a",
    list: [
      { id: "a", bvid: "BV1aaaaaaaaa", cid: "1", title: "A" },
      { id: "b", bvid: "BV1bbbbbbbbb", cid: "2", title: "B" },
    ],
    getPlayItem: () => get().list.find(i => i.id === get().playId),
  }));
  return { usePlayList };
});

import { useLyricsAlignSession } from "@/store/lyrics-align-session";
import { useLyricsState } from "@/store/lyrics-state";
import { usePlayList } from "@/store/play-list";
import { StoreNameMap } from "@shared/store";

// 「每首每份歌词每次会话只发一次」的记录是模块级的，每个用例用不同的歌词
let seq = 0;
let LYRICS = "";
const KEY = "BV1aaaaaaaaa-1";

const alignment: LyricsAlignment = {
  alignerVersion: 1,
  bvid: "BV1aaaaaaaaa",
  cid: "1",
  lyricsHash: "h1",
  video: { title: "A", durationSec: 100 },
  lines: [
    {
      start: 1.2,
      text: "你好",
      score: 0.5,
      words: [
        { text: "你", start: 1.2 },
        { text: "好", start: 1.5 },
      ],
    },
  ],
  quality: { medianScore: 0.5, lowScoreLines: 0, repairedLines: 0 },
  offsetSec: 0.2,
  lrc: "",
  createdAt: 0,
};

const cache = () => h.store[StoreNameMap.LyricsCache] as Record<string, MusicLyrics>;
const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe("automatic alignment while listening", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.isLogin = true;
    LYRICS = `[00:01.00]你好 ${seq++}`;
    h.store = { [StoreNameMap.LyricsCache]: { [KEY]: { lyrics: LYRICS, source: "auto" } } };
    h.createAlignJob.mockReset();
    h.getAlignJob.mockReset();
    usePlayList.setState({ playId: "a" });
    useLyricsState.getState().reset();
  });

  afterEach(() => {
    useLyricsAlignSession.getState().dismiss();
    vi.useRealTimers();
  });

  it("waits a few seconds, then swaps in the result without asking", async () => {
    h.createAlignJob.mockResolvedValue({ id: "j1", state: "queued", position: 3 });
    h.getAlignJob.mockResolvedValue({ id: "j1", state: "done", alignment });
    useLyricsAlignSession.getState().auto(LYRICS, { userChosen: false });
    await settle(4000);
    expect(h.createAlignJob).not.toHaveBeenCalled();
    await settle(1000);
    expect(h.createAlignJob).toHaveBeenCalledWith({ bvid: "BV1aaaaaaaaa", cid: "1", lyrics: LYRICS });
    expect(useLyricsAlignSession.getState().phase).toMatchObject({ kind: "working", view: { position: 3 } });
    await settle(3000);
    expect(useLyricsAlignSession.getState().phase.kind).toBe("idle");
    expect(cache()[KEY]).toMatchObject({ source: "approved", alignment: { lyricsHash: "h1" } });
    expect(useLyricsState.getState().lyrics[0].words?.[1]).toEqual({ text: "好", time: 1500 });

    // 同一首同一份歌词本次会话不再发起
    useLyricsAlignSession.getState().auto(LYRICS, { userChosen: false });
    await settle(6000);
    expect(h.createAlignJob).toHaveBeenCalledTimes(1);
  });

  it("keeps the user's own lyrics as theirs", async () => {
    h.createAlignJob.mockResolvedValue({ id: null, state: "done", alignment });
    useLyricsAlignSession.getState().auto(LYRICS, { userChosen: true, immediate: true });
    await settle(10);
    expect(cache()[KEY].source).toBe("aligned");
  });

  it("does nothing for songs the listener skipped past, or when not logged in", async () => {
    useLyricsAlignSession.getState().auto(LYRICS, { userChosen: false });
    await settle(2000);
    usePlayList.setState({ playId: "b" });
    await settle(5000);
    expect(h.createAlignJob).not.toHaveBeenCalled();

    usePlayList.setState({ playId: "a" });
    h.isLogin = false;
    useLyricsAlignSession.getState().auto("[00:02.00]别的", { userChosen: false });
    await settle(6000);
    expect(h.createAlignJob).not.toHaveBeenCalled();
  });

  it("does not overwrite lyrics the user changed while waiting", async () => {
    h.createAlignJob.mockResolvedValue({ id: "j1", state: "running" });
    h.getAlignJob.mockResolvedValue({ id: "j1", state: "done", alignment });
    useLyricsAlignSession.getState().auto(LYRICS, { userChosen: false, immediate: true });
    await settle(10);
    cache()[KEY].lyrics = "[00:01.00]换了一份";
    await settle(3000);
    expect(cache()[KEY].alignment).toBeUndefined();
  });

  it("stays quiet about failures the listener can't act on, shows the rest without retrying", async () => {
    h.createAlignJob.mockResolvedValueOnce({
      id: null,
      state: "failed",
      error: { code: "LYRICS_UNSUPPORTED", message: "暂时只支持中文和拉丁字母的歌词" },
    });
    useLyricsAlignSession.getState().auto(LYRICS, { userChosen: false, immediate: true });
    await settle(10);
    expect(useLyricsAlignSession.getState().phase.kind).toBe("idle");

    h.createAlignJob.mockResolvedValueOnce({
      id: null,
      state: "failed",
      error: { code: "LYRICS_MISMATCH", message: "歌词和这首歌的音频对不上" },
    });
    useLyricsAlignSession.getState().auto("[00:03.00]另一份", { userChosen: false, immediate: true });
    await settle(10);
    expect(useLyricsAlignSession.getState().phase).toMatchObject({ kind: "failed", code: "LYRICS_MISMATCH" });
    await settle(30_000);
    expect(h.createAlignJob).toHaveBeenCalledTimes(2);
  });
});

describe("admin re-align drafts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.isLogin = true;
    h.isAdmin = true;
    LYRICS = `[00:01.00]你好 ${seq++}`;
    h.store = { [StoreNameMap.LyricsCache]: { [KEY]: { lyrics: LYRICS, source: "auto" } } };
    for (const fn of [h.createAlignJob, h.getAlignJob, h.getAlignDraft, h.discardAlignDraft, h.publishAlignment])
      fn.mockReset();
    h.discardAlignDraft.mockResolvedValue({ ok: true });
    usePlayList.setState({ playId: "a" });
    useLyricsState.getState().reset();
  });

  afterEach(() => {
    useLyricsAlignSession.getState().dismiss();
    vi.useRealTimers();
  });

  it("switching away and back resumes the trial instead of aligning again", async () => {
    h.createAlignJob.mockResolvedValue({ id: "j1", state: "running" });
    h.getAlignJob.mockResolvedValue({ id: "j1", state: "done", alignment, draft: true });
    await useLyricsAlignSession.getState().start(LYRICS);
    await settle(3000);
    expect(useLyricsAlignSession.getState().phase.kind).toBe("preview");

    usePlayList.setState({ playId: "b" });
    expect(useLyricsAlignSession.getState().phase.kind).toBe("idle");
    expect(useLyricsState.getState().preview).toBeNull();

    usePlayList.setState({ playId: "a" });
    h.getAlignDraft.mockResolvedValue({ draft: { lyricsHash: "h1", alignment, createdAt: 1 } });
    await useLyricsAlignSession.getState().restoreDraft();
    expect(useLyricsAlignSession.getState().phase).toMatchObject({ kind: "preview", restored: true });
    expect(useLyricsState.getState().preview?.lyrics[0].text).toBe("你好");
    expect(h.createAlignJob).toHaveBeenCalledTimes(1);

    await useLyricsAlignSession.getState().publish();
    expect(h.publishAlignment).toHaveBeenCalledWith({ bvid: "BV1aaaaaaaaa", cid: "1", lyricsHash: "h1" });
  });

  it("goes straight back to 'ready to publish' when the draft was already adopted here", async () => {
    cache()[KEY] = { lyrics: LYRICS, alignment: { lyricsHash: "h1", lines: alignment.lines } } as MusicLyrics;
    h.getAlignDraft.mockResolvedValue({ draft: { lyricsHash: "h1", alignment, createdAt: 1 } });
    await useLyricsAlignSession.getState().restoreDraft();
    expect(useLyricsAlignSession.getState().phase.kind).toBe("adopted");
    expect(useLyricsState.getState().preview).toBeNull();
  });

  it("only restores for admins, and discarding deletes the server draft", async () => {
    h.isAdmin = false;
    await useLyricsAlignSession.getState().restoreDraft();
    expect(h.getAlignDraft).not.toHaveBeenCalled();

    h.isAdmin = true;
    h.getAlignDraft.mockResolvedValue({ draft: { lyricsHash: "h1", alignment, createdAt: 1 } });
    await useLyricsAlignSession.getState().restoreDraft();
    useLyricsAlignSession.getState().discard();
    expect(h.discardAlignDraft).toHaveBeenCalledWith({ bvid: "BV1aaaaaaaaa", cid: "1", lyricsHash: "h1" });
    expect(useLyricsAlignSession.getState().phase.kind).toBe("idle");
  });

  it("re-running a restored draft goes by its lyrics hash and forces a fresh run", async () => {
    h.getAlignDraft.mockResolvedValue({ draft: { lyricsHash: "h1", alignment, createdAt: 1 } });
    await useLyricsAlignSession.getState().restoreDraft();
    h.realignByHash.mockResolvedValue({ id: "j2", state: "queued", position: 1 });
    h.getAlignJob.mockResolvedValue({ id: "j2", state: "done", alignment, draft: true });
    await useLyricsAlignSession.getState().rerun();
    expect(h.realignByHash).toHaveBeenCalledWith({ bvid: "BV1aaaaaaaaa", cid: "1", lyricsHash: "h1" });
    await settle(3000);
    expect(useLyricsAlignSession.getState().phase).toMatchObject({ kind: "preview", restored: false });

    await useLyricsAlignSession.getState().start(LYRICS);
    h.createAlignJob.mockResolvedValue({ id: "j3", state: "queued" });
    await useLyricsAlignSession.getState().rerun();
    expect(h.createAlignJob).toHaveBeenLastCalledWith({
      bvid: "BV1aaaaaaaaa",
      cid: "1",
      lyrics: LYRICS,
      manual: true,
      force: true,
    });
  });
});
