import { describe, expect, test, beforeEach, vi } from "vitest";

import { getPlayModeList, PlayMode } from "@/common/constants/audio";
import { usePlayList } from "@/store/play-list";

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
});
