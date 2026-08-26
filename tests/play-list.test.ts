import { describe, expect, test, beforeEach, vi } from "vitest";

import { getPlayModeList, PlayMode } from "@/common/constants/audio";
import { refreshCurrentAudioSource, usePlayList } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/151 Mobile/15E148";
vi.mock("@/common/utils/audio", () => ({
  getAudioUrl: vi.fn(async () => ({ audioUrl: "https://audio.test/a.mp3", isLossless: false })),
  getDashUrl: vi.fn(async () => ({
    audioUrl: "https://video.test/a.mp3",
    videoUrl: "https://video.test/v.mp4",
    isLossless: false,
  })),
  getMVUrl: vi.fn(async () => ({
    audioUrl: "https://video.test/a.mp3",
    videoUrl: "https://video.test/v.mp4",
    isLossless: false,
  })),
  isUrlValid: vi.fn(url => typeof url === "string" && url.length > 0),
  isResourceGoneCode: (code?: number) => typeof code === "number" && [-404, 62002, 62012, 7201006].includes(code),
}));

vi.mock("@/service/audio-song-info", () => ({
  getAudioSongInfo: vi.fn(async ({ sid }) => ({
    data: {
      id: sid,
      uid: 1,
      uname: "owner",
      author: "owner",
      title: "audio-title",
      cover: "https://cover.test/c.png",
      intro: "",
      crtype: 1,
      duration: 123,
      passtime: Date.now(),
      curtime: Date.now(),
      aid: 0,
    },
  })),
}));

vi.mock("@/service/web-interface-view", () => ({
  getWebInterfaceView: vi.fn(async () => ({
    data: {
      aid: 100,
      title: "mv-title",
      pic: "https://cover.test/m.png",
      owner: { name: "owner", mid: 1 },
      stat: { view: 888 },
      pages: [
        { cid: 11, page: 1, part: "p1", duration: 60, first_frame: "https://ff.test/1.png" },
        { cid: 12, page: 2, part: "p2", duration: 60, first_frame: "https://ff.test/2.png" },
      ],
    },
  })),
}));

vi.mock("@heroui/react", async () => {
  const actual: any = await vi.importActual("@heroui/react");
  return { ...actual, addToast: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
  usePlayList.getState().clear();
});

/**
 * 在 store 测试里真正把 MSE 跑起来。
 * 「跳到未缓冲位置要重新取流」「ended 后 paused/isPlaying 都为 false」这类问题
 * 只在 MSE 活着时才会出现，非 MSE 环境下所有断言都会恒真（假绿）。
 */
const withFakeMse = () => {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints;
  const mediaSources: unknown[] = [];
  class FakeSB extends EventTarget {
    updating = false;
    buffered = { length: 1, start: () => 0, end: () => 10 };
    appendBuffer() {
      this.updating = true;
      setTimeout(() => {
        this.updating = false;
        this.dispatchEvent(new Event("updateend"));
      }, 0);
    }
    remove() {
      this.updating = true;
      setTimeout(() => {
        this.updating = false;
        this.dispatchEvent(new Event("updateend"));
      }, 0);
    }
  }
  class FakeMS extends EventTarget {
    static isTypeSupported = () => true;
    readyState = "closed";
    duration = NaN;
    addSourceBuffer() {
      return new FakeSB() as unknown as SourceBuffer;
    }
    endOfStream() {}
    constructor() {
      super();
      mediaSources.push(this);
      setTimeout(() => {
        this.readyState = "open";
        this.dispatchEvent(new Event("sourceopen"));
      }, 0);
    }
  }
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: IPHONE_UA });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
  (window as any).ManagedMediaSource = FakeMS;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]) as unknown as BodyInit, { status: 200 })),
  );
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:fake", revokeObjectURL: () => undefined });

  return {
    mediaSources,
    restore: () => {
      Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
      Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: touch });
      delete (window as any).ManagedMediaSource;
      vi.unstubAllGlobals();
    },
  };
};

describe("play-list store", () => {
  test("initial state", () => {
    const s = usePlayList.getState();
    expect(s.isPlaying).toBe(false);
    expect(s.isMuted).toBe(false);
    expect(s.volume).toBe(0.5);
    expect(s.playMode).toBe(PlayMode.Loop);
    expect(s.rate).toBe(1);
    expect(s.list.length).toBe(0);
  });

  test("init sets audio props and handlers", async () => {
    const s = usePlayList.getState();
    await s.init();
    const audio = s.getAudio();
    expect(audio.volume).toBe(0.5);
    expect(audio.muted).toBe(false);
    expect(audio.playbackRate).toBe(1);
    expect(typeof audio.onplay).toBe("function");
  });

  test("setVolume, setRate, setPlayMode", async () => {
    const s = usePlayList.getState();
    await s.init();
    s.setVolume(0.8);
    s.setRate(1.25);
    s.togglePlayMode();
    s.togglePlayMode();
    const audio = s.getAudio();
    expect(usePlayList.getState().volume).toBe(0.8);
    expect(audio.volume).toBe(0.8);
    expect(usePlayList.getState().rate).toBe(1.25);
    expect(audio.playbackRate).toBe(1.25);
    expect(usePlayList.getState().playMode).toBe(PlayMode.Single);
    expect(audio.loop).toBe(true);
  });

  test("play audio adds item and toggles playing", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.play({ type: "audio", sid: 101, title: "a", cover: "", ownerName: "", ownerMid: 0 });
    expect(usePlayList.getState().list.length).toBe(1);
    const id = usePlayList.getState().playId as string;
    expect(typeof id).toBe("string");
    const audio = s.getAudio();
    expect(audio.src).toContain("audio.test");
    expect(navigator.mediaSession.playbackState).toBe("playing");
  });

  test("play preserves the duration supplied by a search/list result", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.play({
      type: "mv",
      bvid: "BVx",
      title: "mv",
      cover: "https://cover.test/m.png",
      ownerName: "owner",
      ownerMid: 1,
      duration: 274,
    });

    expect(usePlayList.getState().getPlayItem()?.duration).toBe(274);
  });

  test("resolving a multi-page placeholder starts its media source only once", async () => {
    const s = usePlayList.getState();
    await s.init();
    const audio = s.getAudio();
    const load = vi.spyOn(audio, "load");

    await s.play({ type: "mv", bvid: "BVx", title: "mv" });

    expect(load).toHaveBeenCalledTimes(1);
    expect(usePlayList.getState().list).toHaveLength(2);
    expect(usePlayList.getState().playId).toBe(usePlayList.getState().list[0].id);
  });

  test("a late source resolution cannot overwrite a newer selected song", async () => {
    const s = usePlayList.getState();
    await s.init();
    const { getDashUrl } = await import("@/common/utils/audio");
    let resolveFirst: (value: { audioUrl: string; isLossless: boolean }) => void = () => {};
    let resolveSecond: (value: { audioUrl: string; isLossless: boolean }) => void = () => {};
    vi.mocked(getDashUrl)
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveSecond = resolve;
          }),
      );

    usePlayList.setState({
      list: [
        { bvid: "BV-first", cid: "1", id: "first", title: "first", type: "mv" },
        { bvid: "BV-second", cid: "2", id: "second", title: "second", type: "mv" },
      ],
      playId: undefined,
    });
    usePlayList.setState({ playId: "first" });
    await Promise.resolve();
    usePlayList.setState({ playId: "second" });
    await Promise.resolve();

    resolveSecond({ audioUrl: "https://audio.test/second.m4s", isLossless: false });
    await vi.waitFor(() => expect(s.getAudio().src).toContain("second.m4s"));
    resolveFirst({ audioUrl: "https://audio.test/first.m4s", isLossless: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(s.getAudio().src).toContain("second.m4s");
    expect(usePlayList.getState().list.find(item => item.id === "first")?.audioUrl).toBeUndefined();
    expect(usePlayList.getState().list.find(item => item.id === "second")?.audioUrl).toContain("second.m4s");
  });

  test("concurrent playback failures single-flight source refresh by play id", async () => {
    const { getDashUrl } = await import("@/common/utils/audio");
    usePlayList.setState({
      list: [
        {
          audioUrl: "https://audio.test/current.m4s?deadline=9999999999",
          bvid: "BV-refresh",
          cid: "1",
          id: "refresh",
          title: "refresh",
          type: "mv",
        },
      ],
      playId: "refresh",
    });
    await Promise.resolve();
    usePlayList.setState({
      list: [{ bvid: "BV-refresh", cid: "1", id: "refresh", title: "refresh", type: "mv" }],
    });

    let resolveRefresh: (value: { audioUrl: string; isLossless: boolean }) => void = () => {};
    vi.mocked(getDashUrl).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRefresh = resolve;
        }),
    );
    const first = refreshCurrentAudioSource();
    const concurrent = refreshCurrentAudioSource();
    expect(getDashUrl).toHaveBeenCalledTimes(1);
    resolveRefresh({ audioUrl: "https://audio.test/refreshed.m4s", isLossless: false });

    await expect(Promise.all([first, concurrent])).resolves.toEqual([true, true]);
    expect(getDashUrl).toHaveBeenCalledTimes(1);
  });

  test("playback state prefers the Bilibili duration over the media stream duration", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.play({
      type: "mv",
      bvid: "BVx",
      title: "mv",
      cover: "https://cover.test/m.png",
      ownerName: "owner",
      ownerMid: 1,
      duration: 274,
    });

    const media = s.getAudio() as HTMLAudioElement & { ondurationchange?: () => void };
    media.duration = 273.4;
    media.ondurationchange?.();

    expect(usePlayList.getState().duration).toBe(274);
  });

  test("playList sets list and next/prev in sequence", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.playList([
      { type: "audio", sid: 1, title: "a1" },
      { type: "audio", sid: 2, title: "a2" },
    ]);
    const firstId = usePlayList.getState().playId as string;
    await s.next();
    const secondId = usePlayList.getState().playId as string;
    expect(secondId).not.toBe(firstId);
    await s.prev();
    expect(usePlayList.getState().playId).toBe(firstId);
  });

  test("更换播放全部时立即清除旧源并采用新首曲目的时长", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.playList([
      {
        type: "audio",
        source: "local",
        id: "old-local",
        audioUrl: "https://audio.test/old.mp3",
        title: "旧歌",
        duration: 238,
      },
    ]);
    await vi.waitFor(() => expect(s.getAudio().src).toContain("old.mp3"));

    const { getDashUrl } = await import("@/common/utils/audio");
    let resolveNewSource: (value: { audioUrl: string; isLossless: boolean }) => void = () => {};
    vi.mocked(getDashUrl).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveNewSource = resolve;
        }),
    );

    await s.playList([{ type: "mv", bvid: "BV-new", cid: "2", title: "新歌", duration: 293 }]);

    expect(usePlayList.getState().getPlayItem()?.title).toBe("新歌");
    expect(usePlayList.getState().duration).toBe(293);
    expect(s.getAudio().src).toBe("");

    resolveNewSource({ audioUrl: "https://audio.test/new.m4s", isLossless: false });
    await vi.waitFor(() => expect(s.getAudio().src).toContain("new.m4s"));
  });

  test("random mode keeps pages order", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.playList([{ type: "mv", bvid: "BVx", title: "m1" }]);
    const mv = usePlayList.getState().list[0];
    const { getWebInterfaceView } = await import("@/service/web-interface-view");
    const pages = await getWebInterfaceView({ bvid: mv.bvid as string });
    usePlayList.setState(() => ({
      list: pages.data.pages.map(p => ({
        id: `${p.page}-id`,
        type: "mv",
        bvid: mv.bvid,
        aid: "100",
        cid: String(p.cid),
        title: "mv-title",
        cover: "",
        ownerName: "owner",
        ownerMid: 1,
        hasMultiPart: true,
        pageIndex: p.page,
        pageTitle: p.part,
        pageCover: p.first_frame,
        totalPage: pages.data.pages.length,
        duration: p.duration,
      })),
      playId: "1-id",
    }));
    s.togglePlayMode();
    s.setShouldKeepPagesOrderInRandomPlayMode(true);
    await s.next();
    expect(usePlayList.getState().playId).toBe("2-id");
  });

  test("random mode plays every song before repeating", async () => {
    const s = usePlayList.getState();
    await s.init();
    // 先切到随机模式，再灌入队列，让 playList 初始化本轮已播集合
    usePlayList.setState({ playMode: PlayMode.Random });
    await s.playList([
      { type: "audio", sid: 1, title: "a1" },
      { type: "audio", sid: 2, title: "a2" },
      { type: "audio", sid: 3, title: "a3" },
      { type: "audio", sid: 4, title: "a4" },
      { type: "audio", sid: 5, title: "a5" },
      { type: "audio", sid: 6, title: "a6" },
    ]);
    const total = usePlayList.getState().list.length;
    const allIds = new Set(usePlayList.getState().list.map(i => i.id));

    // 一整轮：起始歌 + (total-1) 次 next，应恰好覆盖全部歌曲且无重复
    const firstCycle = [usePlayList.getState().playId as string];
    for (let i = 0; i < total - 1; i++) {
      await s.next();
      firstCycle.push(usePlayList.getState().playId as string);
    }
    expect(new Set(firstCycle).size).toBe(total);
    expect(new Set(firstCycle)).toEqual(allIds);

    // 跨轮边界：新一轮第一首不能与上一轮最后一首相同（避免紧挨重复）
    const lastOfFirst = firstCycle[firstCycle.length - 1];
    await s.next();
    expect(usePlayList.getState().playId).not.toBe(lastOfFirst);

    // 新一轮同样不重复地覆盖全部歌曲
    const secondCycle = [usePlayList.getState().playId as string];
    for (let i = 0; i < total - 1; i++) {
      await s.next();
      secondCycle.push(usePlayList.getState().playId as string);
    }
    expect(new Set(secondCycle).size).toBe(total);
  });

  test("再次播放全部会重置随机轮次，之前听过的歌可再次播放", async () => {
    const s = usePlayList.getState();
    await s.init();
    usePlayList.setState({ playMode: PlayMode.Random });

    const songs = [
      { type: "audio" as const, sid: 1, title: "a1" },
      { type: "audio" as const, sid: 2, title: "a2" },
      { type: "audio" as const, sid: 3, title: "a3" },
      { type: "audio" as const, sid: 4, title: "a4" },
    ];
    const sidOf = (id?: string) => usePlayList.getState().list.find(i => i.id === id)?.sid;

    // 第一次「播放全部」，听掉 3 首（模拟 a、b、c）
    await s.playList(songs);
    const playedSids = new Set([sidOf(usePlayList.getState().playId)]);
    for (let i = 0; i < 2; i++) {
      await s.next();
      playedSids.add(sidOf(usePlayList.getState().playId));
    }
    expect(playedSids.size).toBe(3);

    // 再次「播放全部」：已播集合应重置为只含起始歌
    await s.playList(songs);
    expect(usePlayList.getState().randomPlayedIds.length).toBe(1);

    // 新一轮完整跑一遍，应覆盖全部 4 首
    const total = usePlayList.getState().list.length;
    const newSids = new Set([sidOf(usePlayList.getState().playId)]);
    for (let i = 0; i < total - 1; i++) {
      await s.next();
      newSids.add(sidOf(usePlayList.getState().playId));
    }
    expect(newSids).toEqual(new Set([1, 2, 3, 4]));
    // 上一轮听过的歌，在新一轮里都能再被播到
    for (const sid of playedSids) {
      expect(newSids.has(sid)).toBe(true);
    }
  });

  test("已移除顺序播放，播放模式只剩循环/随机/单曲", () => {
    const modes = getPlayModeList();
    expect(modes).toHaveLength(3);
    expect(modes.map(m => m.desc)).toEqual(["循环播放", "随机播放", "单曲播放"]);
    expect(modes.some(m => m.desc === "顺序播放")).toBe(false);
  });

  test("播到队尾不再停止：循环模式下从最后一首会回绕到第一首", async () => {
    const s = usePlayList.getState();
    await s.init();
    usePlayList.setState({ playMode: PlayMode.Loop });
    await s.playList([
      { type: "audio" as const, sid: 1, title: "a1" },
      { type: "audio" as const, sid: 2, title: "a2" },
      { type: "audio" as const, sid: 3, title: "a3" },
    ]);
    // 模拟「搜索播放一首歌追加到队尾」：跳到最后一首
    const list = usePlayList.getState().list;
    usePlayList.setState({ playId: list[list.length - 1].id });
    await s.next();
    // 旧 bug：顺序模式到队尾会停止；现在循环模式应回绕到第一首继续播
    expect(usePlayList.getState().playId).toBe(list[0].id);
  });

  test("点歌插入到当前歌曲的下一位并切过去播放，而不是追加到队尾", async () => {
    const s = usePlayList.getState();
    await s.init();
    usePlayList.setState({ playMode: PlayMode.Loop });
    await s.playList([
      { type: "audio" as const, sid: 1, title: "a1" },
      { type: "audio" as const, sid: 2, title: "a2" },
      { type: "audio" as const, sid: 3, title: "a3" },
    ]);
    // 当前在第一首，模拟全网搜索点歌
    await s.play({
      type: "audio",
      sid: 99,
      title: "搜索歌",
      cover: "https://c.test/1.png",
      ownerName: "up",
      ownerMid: 9,
    });

    const { list, playId } = usePlayList.getState();
    expect(list.map(i => i.sid)).toEqual([1, 99, 2, 3]);
    expect(playId).toBe(list[1].id);

    // 插入的歌播完后顺着原歌单继续，而不是绕回歌单开头
    await s.next();
    const after = usePlayList.getState();
    expect(after.list.find(i => i.id === after.playId)?.sid).toBe(2);
  });

  test("分集从收藏夹播放时，显示标题用收藏夹里的名字而不是 B 站分 P 名", async () => {
    const s = usePlayList.getState();
    await s.init();
    // 收藏的是 BVx 的 P1（cid=11，分 P 名为 "p1"），收藏夹里名字被调整为「原歌名-P1」
    await s.play({ type: "mv", bvid: "BVx", cid: "11", title: "原歌名-P1", cover: "https://fav.test/cover.png" });

    let state = usePlayList.getState();
    expect(state.list).toHaveLength(1);
    expect(state.list[0].cid).toBe("11");
    // 播放栏显示 pageTitle || title / pageCover || cover，应与收藏夹列表一致，
    // 而不是分 P 名 "p1" 和分 P 首帧截图
    expect(state.list[0].pageTitle).toBe("原歌名-P1");
    expect(state.list[0].pageCover).toBe("https://fav.test/cover.png");
    expect(state.playId).toBe(state.list[0].id);

    // 收藏夹里重命名后再次点击同一首，显示标题/封面同步更新
    await s.play({ type: "mv", bvid: "BVx", cid: "11", title: "重命名后", cover: "https://fav.test/cover2.png" });
    state = usePlayList.getState();
    expect(state.list[0].pageTitle).toBe("重命名后");
    expect(state.list[0].pageCover).toBe("https://fav.test/cover2.png");
  });

  test("addToNext inserts after current", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.playList([{ type: "audio", sid: 10, title: "a10" }]);
    const currentId = usePlayList.getState().playId as string;
    await s.addToNext({ type: "audio", sid: 20, title: "a20" });
    const idx = usePlayList.getState().list.findIndex(i => i.id === currentId);
    const nextItem = usePlayList.getState().list[idx + 1];
    expect(usePlayList.getState().nextId).toBe(nextItem.id);
    expect(nextItem.sid).toBe(20);
  });

  test("addList deduplicates and preserves playing item", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.playList([{ type: "audio", sid: 1, title: "a1" }]);
    await s.addList([
      { type: "audio", sid: 1, title: "a1" },
      { type: "audio", sid: 3, title: "a3" },
    ]);
    expect(usePlayList.getState().list.some(i => i.sid === 1)).toBe(true);
    expect(usePlayList.getState().list.some(i => i.sid === 3)).toBe(true);
    const newId = usePlayList.getState().playId as string;
    const newItem = usePlayList.getState().list.find(i => i.id === newId);
    expect(newItem?.sid).toBe(1);
  });

  test("del removes by id and clear works", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.playList([
      { type: "audio", sid: 1, title: "a1" },
      { type: "audio", sid: 2, title: "a2" },
    ]);
    const otherId = usePlayList.getState().list.find(i => i.sid === 2)?.id as string;
    await s.del(otherId);
    expect(usePlayList.getState().list.some(i => i.id === otherId)).toBe(false);
    s.clear();
    expect(usePlayList.getState().list.length).toBe(0);
    expect(usePlayList.getState().playId).toBeUndefined();
  });

  test("play handles data fetch failure gracefully", async () => {
    const s = usePlayList.getState();
    await s.init();
    // Mock getWebInterfaceView to return empty/error structure
    const { getWebInterfaceView } = await import("@/service/web-interface-view");
    vi.mocked(getWebInterfaceView).mockResolvedValueOnce({ code: -1 } as any);

    // This should not crash
    await s.play({ type: "mv", bvid: "BV_fail", title: "fail" });
    expect(usePlayList.getState().list.length).toBe(0);
  });

  test("addToNext handles data fetch failure gracefully", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.playList([{ type: "audio", sid: 1, title: "a1" }]);

    const { getWebInterfaceView } = await import("@/service/web-interface-view");
    vi.mocked(getWebInterfaceView).mockResolvedValueOnce({ code: -1 } as any);

    await s.addToNext({ type: "mv", bvid: "BV_fail", title: "fail" });
    expect(usePlayList.getState().list.length).toBe(1);
  });

  test("播到已被删除的歌曲时自动跳过并从播放列表移除", async () => {
    const s = usePlayList.getState();
    await s.init();

    const { getDashUrl } = await import("@/common/utils/audio");
    const { getWebInterfaceView } = await import("@/service/web-interface-view");
    // 当前歌（已被删除）：取不到播放地址，且稿件接口返回 -404（已失效）；后续 alive 走默认 mock（可播放）
    vi.mocked(getDashUrl).mockImplementationOnce(async () => ({ isLossless: false }) as any);
    vi.mocked(getWebInterfaceView).mockImplementationOnce(async () => ({ code: -404 }) as any);

    usePlayList.setState({
      list: [
        { id: "dead", type: "mv", bvid: "BV_dead", cid: "1", title: "已删除" },
        { id: "alive", type: "mv", bvid: "BV_alive", cid: "2", title: "正常" },
      ],
      playId: "dead",
    });

    // 订阅副作用是异步的：等待「失效检测 → 移除 → 自动续播」完成
    await vi.waitFor(() => {
      const st = usePlayList.getState();
      expect(st.list.some(i => i.id === "dead")).toBe(false);
      expect(st.list.length).toBe(1);
      expect(st.playId).toBe("alive");
    });
  });

  test("取不到播放地址但稿件未失效（如临时网络故障）时不会误删", async () => {
    const s = usePlayList.getState();
    await s.init();

    const { getDashUrl } = await import("@/common/utils/audio");
    const { getWebInterfaceView } = await import("@/service/web-interface-view");
    // 取不到地址，但稿件接口未返回失效码（默认 mock 无 code）→ 应保守保留，不删
    vi.mocked(getDashUrl).mockImplementationOnce(async () => ({ isLossless: false }) as any);

    usePlayList.setState({
      list: [
        { id: "a", type: "mv", bvid: "BV_a", cid: "1", title: "a" },
        { id: "b", type: "mv", bvid: "BV_b", cid: "2", title: "b" },
      ],
      playId: "a",
    });

    // 给副作用足够的时间执行，确认不会移除 a
    await vi.waitFor(() => {
      expect(vi.mocked(getWebInterfaceView)).toHaveBeenCalled();
    });
    expect(usePlayList.getState().list.some(i => i.id === "a")).toBe(true);
    expect(usePlayList.getState().list.length).toBe(2);
  });

  // —— 播放量 carry-through：播放时把播放量带进队列，收藏时直接沿用、无需回查 infos ——

  test("play() 把 playCount 带进当前播放项（元数据齐全时零回查）", async () => {
    const s = usePlayList.getState();
    await s.init();
    // cover/owner 齐全 → 跳过 getMVData/getAudioData，直接用传入的 playCount
    await s.play({ type: "audio", sid: 202, title: "a", cover: "c", ownerName: "o", ownerMid: 1, playCount: 12345 });
    expect(usePlayList.getState().getPlayItem()?.playCount).toBe(12345);
  });

  test("play() 需回查元数据时，从 getMVData 的 stat.view 顺带取播放量", async () => {
    const s = usePlayList.getState();
    await s.init();
    // 缺 cover → 触发 getMVData，播放量取自 stat.view（mock = 888）
    await s.play({ type: "mv", bvid: "BVstat", title: "m" });
    expect(usePlayList.getState().getPlayItem()?.playCount).toBe(888);
  });

  // —— 换源自救节流：坏源 / 弱网时不能把请求打成风暴 ——

  test("单曲连续播放失败时，换源次数有上限且带最小间隔", async () => {
    vi.useFakeTimers();
    try {
      const s = usePlayList.getState();
      await s.init();
      const audio = s.getAudio();

      usePlayList.setState({
        list: [
          {
            id: "bad",
            type: "mv",
            bvid: "BV_bad",
            cid: "1",
            title: "bad",
            audioUrl: "https://cdn.test/0.mp3",
            audioUrlCandidates: [
              "https://cdn.test/1.mp3",
              "https://cdn.test/2.mp3",
              "https://cdn.test/3.mp3",
              "https://cdn.test/4.mp3",
              "https://cdn.test/5.mp3",
            ],
          },
        ],
        playId: "bad",
      });
      audio.src = "https://cdn.test/0.mp3";
      const load = vi.spyOn(audio, "load");
      (audio as any).error = { code: 2, message: "network" };

      // 模拟坏源：每次换完源立刻再次失败
      for (let i = 0; i < 10; i += 1) {
        audio.onerror?.(new Event("error") as any);
        await vi.advanceTimersByTimeAsync(3000);
      }

      // 换源最多 3 次（2 个备用地址 + 1 次重新取址），不会把 5 个候选一口气烧完
      expect(load.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("播完前预取下一首地址，ended 时可同步切歌（手机锁屏续播）", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.play({ type: "audio", sid: 401, title: "one" });
    usePlayList.setState(state => {
      state.list.push({ id: "second", type: "audio", sid: 402, title: "two" } as any);
    });

    const audio = s.getAudio();
    vi.spyOn(audio, "load").mockImplementation(() => {});
    vi.spyOn(audio, "play").mockResolvedValue(undefined as any);
    Object.defineProperty(audio, "duration", { value: 100, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 95, writable: true, configurable: true });
    Object.defineProperty(audio, "paused", { value: true, configurable: true });

    // 还在播放中：提前把下一首的地址取好
    audio.ontimeupdate?.(new Event("timeupdate"));
    await vi.waitFor(() => {
      expect(usePlayList.getState().list.find(item => item.id === "second")?.audioUrl).toBeTruthy();
    });

    const { getAudioUrl } = await import("@/common/utils/audio");
    (getAudioUrl as any).mockClear();
    audio.src = "";

    // 播完：切歌必须是纯同步的（不再等任何网络请求），否则锁屏下会停住
    audio.onended?.(new Event("ended"));
    expect(usePlayList.getState().playId).toBe("second");
    expect(audio.src).toContain("audio.test");
    expect(getAudioUrl).not.toHaveBeenCalled();
  });

  test("拖动进度条到未缓冲位置：连续 seek 只重新取流一次，不是每动一下取一次", async () => {
    const mse = withFakeMse();
    try {
      const s = usePlayList.getState();
      await s.init();
      const audio = s.getAudio();
      vi.spyOn(audio, "play").mockResolvedValue(undefined as any);

      await s.play({ type: "audio", sid: 701, title: "scrub" });
      await vi.waitFor(() => expect(mse.mediaSources.length).toBe(1));
      const mountsAfterPlay = mse.mediaSources.length;

      // 假 SourceBuffer 的 buffered 恒为 [0,10]，下面这些目标都在缓冲区之外。
      // 进度条 Slider 用的是连续触发的 onChange：模拟一次拖动。
      for (const t of [30, 45, 60, 75, 90, 120]) s.seek(t);
      expect(mse.mediaSources.length).toBe(mountsAfterPlay); // 停手前不重新取流

      await new Promise(resolve => setTimeout(resolve, 400));
      // 一次拖动 = 最多一次重新挂载，而不是 6 次
      expect(mse.mediaSources.length).toBe(mountsAfterPlay + 1);
      expect(usePlayProgress.getState().currentTime).toBe(120);
    } finally {
      mse.restore();
    }
  });

  test("跳转加载期间进度条停在目标位置，不被旧位置的 timeupdate 拉回去", async () => {
    const mse = withFakeMse();
    try {
      const s = usePlayList.getState();
      await s.init();
      const audio = s.getAudio();
      vi.spyOn(audio, "play").mockResolvedValue(undefined as any);
      await s.play({ type: "audio", sid: 901, title: "hold" });
      await vi.waitFor(() => expect(mse.mediaSources.length).toBe(1));

      // 跳到缓冲区之外（假 SourceBuffer 的 buffered 恒为 [0,10]）
      s.seek(115);
      expect(usePlayProgress.getState().currentTime).toBe(115);

      // 元素还停在旧位置，timeupdate 会一路上报旧时间 —— 进度条不能被拉回去
      audio.currentTime = 3;
      audio.ontimeupdate?.(new Event("timeupdate"));
      audio.currentTime = 4;
      audio.ontimeupdate?.(new Event("timeupdate"));
      expect(usePlayProgress.getState().currentTime).toBe(115);

      // 数据到位、定位落实后交还控制权
      audio.currentTime = 115;
      audio.onseeked?.(new Event("seeked"));
      audio.currentTime = 116;
      audio.ontimeupdate?.(new Event("timeupdate"));
      expect(usePlayProgress.getState().currentTime).toBe(116);
    } finally {
      mse.restore();
    }
  });

  test("点击跳转不会为同一个目标重复取流（Slider 按下/抬起各发一次 onChange）", async () => {
    const mse = withFakeMse();
    try {
      const s = usePlayList.getState();
      await s.init();
      const audio = s.getAudio();
      vi.spyOn(audio, "play").mockResolvedValue(undefined as any);
      await s.play({ type: "audio", sid: 902, title: "tap" });
      await vi.waitFor(() => expect(mse.mediaSources.length).toBe(1));

      // 按下时一次
      s.seek(115);
      await new Promise(resolve => setTimeout(resolve, 400));
      expect(mse.mediaSources.length).toBe(2);

      // 抬起时又一次（间隔超过防抖窗）：同一个目标，不该再取一遍流
      s.seek(115);
      await new Promise(resolve => setTimeout(resolve, 400));
      expect(mse.mediaSources.length).toBe(2);
    } finally {
      mse.restore();
    }
  });

  test("单首列表播完后会从头重播（MSE 下同样成立）", async () => {
    const mse = withFakeMse();
    try {
      const s = usePlayList.getState();
      await s.init();
      const audio = s.getAudio();
      const play = vi.spyOn(audio, "play").mockResolvedValue(undefined as any);

      await s.play({ type: "audio", sid: 801, title: "only" });
      await vi.waitFor(() => expect(mse.mediaSources.length).toBe(1));
      expect(usePlayList.getState().list).toHaveLength(1);

      // 播放自然结束：规范里 ended 之前会先 pause，所以 paused/isPlaying 都已是 false
      audio.pause();
      play.mockClear();
      audio.onended?.(new Event("ended"));

      // 重新挂载并起播（单首循环等价于「从头重播这一首」）
      await vi.waitFor(() => expect(mse.mediaSources.length).toBe(2));
      expect(play).toHaveBeenCalled();
    } finally {
      mse.restore();
    }
  });

  test("addList() 透传 playCount 到队列项", async () => {
    const s = usePlayList.getState();
    await s.init();
    await s.play({ type: "audio", sid: 300, title: "seed", cover: "c", ownerName: "o", ownerMid: 1 });
    await s.addList([{ type: "audio", sid: 303, title: "x", cover: "c", ownerName: "o", ownerMid: 1, playCount: 777 }]);
    expect(usePlayList.getState().list.some(i => i.playCount === 777)).toBe(true);
  });
});
