import { describe, expect, test, beforeEach, vi } from "vitest";

import { PlayMode } from "@/common/constants/audio";
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

vi.mock("@/service/player-pagelist", () => ({
  getPlayerPagelist: vi.fn(async () => ({
    code: 0,
    data: [
      { cid: 11, page: 1, part: "p1", duration: 60, first_frame: "https://ff.test/1.png" },
      { cid: 12, page: 2, part: "p2", duration: 60, first_frame: "https://ff.test/2.png" },
    ],
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
  const actual = await vi.importActual<typeof import("@heroui/react")>("@heroui/react");
  return { ...actual, addToast: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
  usePlayList.getState().clear();
});

const pausedError = () =>
  Object.assign(new Error("synthetic playback pause"), {
    response: { status: 423, data: { code: "BIU_MEDIA_PAUSED" } },
  });

describe("取址停手的原播放状态机", () => {
  test("暂停错误不被当成无地址，不查失效也不删除歌曲", async () => {
    const { getDashUrl } = await import("@/common/utils/audio");
    const { getWebInterfaceView } = await import("@/service/web-interface-view");
    vi.mocked(getDashUrl).mockRejectedValue(pausedError());
    const s = usePlayList.getState();
    await s.init();
    const play = vi.spyOn(s.getAudio(), "play");
    usePlayList.setState({
      list: [
        {
          id: "paused-mv",
          type: "mv",
          bvid: "BVfixture",
          cid: "1",
          title: "fixture",
          cover: "https://cover.test/a.jpg",
        },
      ],
      playId: "paused-mv",
    });
    await vi.waitFor(() => expect(getDashUrl).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(usePlayList.getState().isPlaying).toBe(false);
    expect(usePlayList.getState().list.map(item => item.id)).toEqual(["paused-mv"]);
    expect(getWebInterfaceView).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  test("NotSupportedError刷新收到暂停后不再次play或重放取址", async () => {
    const { getAudioUrl } = await import("@/common/utils/audio");
    vi.mocked(getAudioUrl).mockRejectedValue(pausedError());
    const s = usePlayList.getState();
    await s.init();
    const play = vi
      .spyOn(s.getAudio(), "play")
      .mockRejectedValueOnce(new DOMException("decode fixture", "NotSupportedError"));
    usePlayList.setState({
      list: [
        { id: "unsupported", type: "audio", sid: 91, title: "fixture", audioUrl: "https://audio.test/fixture.mp3" },
      ],
      playId: "unsupported",
    });
    await vi.waitFor(() => expect(getAudioUrl).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(play).toHaveBeenCalledTimes(1);
    expect(usePlayList.getState().isPlaying).toBe(false);
    expect(usePlayList.getState().playId).toBe("unsupported");
  });

  test("预取停手不打断当前缓冲播放，也不周期重试同一对歌曲", async () => {
    const { getAudioUrl } = await import("@/common/utils/audio");
    vi.mocked(getAudioUrl).mockRejectedValue(pausedError());
    const s = usePlayList.getState();
    await s.init();
    usePlayList.setState({
      playMode: PlayMode.Loop,
      list: [
        { id: "playing", type: "audio", sid: 101, title: "fixture", audioUrl: "https://audio.test/playing.mp3" },
        { id: "next", type: "audio", sid: 102, title: "next" },
      ],
      playId: "playing",
    });
    await vi.waitFor(() => expect(usePlayList.getState().isPlaying).toBe(true));
    const audio = s.getAudio();
    Object.defineProperty(audio, "duration", { value: 100, configurable: true });
    audio.currentTime = 95;
    for (let i = 0; i < 5; i++) audio.ontimeupdate?.(new Event("timeupdate"));
    await vi.waitFor(() => expect(getAudioUrl).toHaveBeenCalledTimes(1));
    expect(usePlayList.getState().playId).toBe("playing");
    expect(usePlayList.getState().isPlaying).toBe(true);
    expect(usePlayList.getState().list[1].audioUrl).toBeUndefined();
  });

  test("旧曲迟到NotSupportedError不刷新或暂停新曲", async () => {
    const { getAudioUrl } = await import("@/common/utils/audio");
    const s = usePlayList.getState();
    await s.init();
    let rejectOld: (reason: unknown) => void = () => {};
    vi.spyOn(s.getAudio(), "play").mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    usePlayList.setState({
      list: [
        { id: "old", type: "audio", sid: 201, title: "old", audioUrl: "https://audio.test/old.mp3" },
        { id: "new", type: "audio", sid: 202, title: "new", audioUrl: "https://audio.test/new.mp3" },
      ],
      playId: "old",
    });
    usePlayList.setState({ playId: "new" });
    await vi.waitFor(() => expect(usePlayList.getState().isPlaying).toBe(true));
    rejectOld(new DOMException("old", "NotSupportedError"));
    await Promise.resolve();
    await Promise.resolve();
    expect(getAudioUrl).not.toHaveBeenCalled();
    expect(usePlayList.getState().playId).toBe("new");
    expect(usePlayList.getState().isPlaying).toBe(true);
  });
});
