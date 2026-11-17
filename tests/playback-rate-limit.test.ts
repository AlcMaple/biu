import { addToast } from "@heroui/react";
import { AxiosError, AxiosHeaders } from "axios";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getAudioUrl, getDashUrl } from "@/common/utils/audio";
import { BILI_RATE_LIMIT_MESSAGE, BiliRateLimitError } from "@/common/utils/bili-rate-limit";
import { getAudioWebStreamUrl } from "@/service/audio-web-url";
import { getPlayerPlayurl } from "@/service/player-playurl";
import { getWebInterfaceView } from "@/service/web-interface-view";
import { usePlayList } from "@/store/play-list";

vi.mock("@/service/player-playurl", () => ({ getPlayerPlayurl: vi.fn() }));
vi.mock("@/service/audio-web-url", () => ({ getAudioWebStreamUrl: vi.fn() }));
vi.mock("@/service/web-interface-view", () => ({ getWebInterfaceView: vi.fn(async () => ({ code: 0, data: {} })) }));
vi.mock("@/service/audio-song-info", () => ({ getAudioSongInfo: vi.fn(async () => ({ code: 0, data: {} })) }));
vi.mock("@heroui/react", async () => {
  const actual: any = await vi.importActual("@heroui/react");
  return { ...actual, addToast: vi.fn() };
});

const httpError = (status: number) =>
  new AxiosError("failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  });

const playurlOk = (url: string) =>
  ({ code: 0, data: { dash: { audio: [{ id: 30280, bandwidth: 1, codecs: "mp4a", baseUrl: url }] } } }) as any;

const rateLimitToasts = () =>
  vi.mocked(addToast).mock.calls.filter(([toast]) => toast.title === BILI_RATE_LIMIT_MESSAGE).length;

describe("取址接口识别限流", () => {
  beforeEach(() => vi.clearAllMocks());

  test.each([-412, -352])("playurl 业务码 %i 抛出限流错误，而不是当成拿不到地址", async code => {
    vi.mocked(getPlayerPlayurl).mockResolvedValueOnce({ code } as any);
    await expect(getDashUrl("BV1", 1)).rejects.toBeInstanceOf(BiliRateLimitError);
  });

  test.each([412, 429])("playurl HTTP %i 抛出限流错误", async status => {
    vi.mocked(getPlayerPlayurl).mockRejectedValueOnce(httpError(status));
    await expect(getDashUrl("BV1", 1)).rejects.toBeInstanceOf(BiliRateLimitError);
  });

  test.each([-400, -404])("playurl 其他业务码 %i 保持拿不到地址的旧语义", async code => {
    vi.mocked(getPlayerPlayurl).mockResolvedValueOnce({ code } as any);
    expect((await getDashUrl("BV1", 1)).audioUrl).toBeFalsy();
  });

  test.each([403, 500, 502])("playurl HTTP %i 不算限流", async status => {
    vi.mocked(getPlayerPlayurl).mockRejectedValueOnce(httpError(status));
    await expect(getDashUrl("BV1", 1)).resolves.toEqual({ isLossless: false });
  });

  test("音频区取址的业务码和 HTTP 状态同样识别", async () => {
    vi.mocked(getAudioWebStreamUrl).mockResolvedValueOnce({ code: -412 } as any);
    await expect(getAudioUrl(1)).rejects.toBeInstanceOf(BiliRateLimitError);
    vi.mocked(getAudioWebStreamUrl).mockRejectedValueOnce(httpError(429));
    await expect(getAudioUrl(1)).rejects.toBeInstanceOf(BiliRateLimitError);
    vi.mocked(getAudioWebStreamUrl).mockRejectedValueOnce(httpError(500));
    await expect(getAudioUrl(1)).rejects.toBeInstanceOf(AxiosError);
  });
});

describe("被限流后播放器停手", () => {
  let fetchStatus = 200;
  const fetchMock = vi.fn(async () => new Response(null, { status: fetchStatus }));

  beforeEach(async () => {
    vi.clearAllMocks();
    fetchStatus = 200;
    vi.stubGlobal("fetch", fetchMock);
    usePlayList.getState().clear();
    // 空列表下的 togglePlay 只做「用户手势」复位，清掉上一个用例留下的停手状态
    usePlayList.getState().togglePlay();
    await usePlayList.getState().init();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("切到新歌时取址被限流：停在这首、不查失效、不跳歌、提示写明限流", async () => {
    vi.mocked(getPlayerPlayurl).mockResolvedValue({ code: -412 } as any);
    usePlayList.setState({
      list: [
        { id: "a", type: "mv", bvid: "BV_a", cid: "1", title: "a" },
        { id: "b", type: "mv", bvid: "BV_b", cid: "2", title: "b" },
      ],
      playId: "a",
    });

    await vi.waitFor(() => expect(rateLimitToasts()).toBe(1));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(getPlayerPlayurl).toHaveBeenCalledTimes(1);
    expect(getWebInterfaceView).not.toHaveBeenCalled();
    expect(usePlayList.getState().playId).toBe("a");
    expect(usePlayList.getState().list.map(item => item.id)).toEqual(["a", "b"]);
    expect(usePlayList.getState().isPlaying).toBe(false);
  });

  test.each([412, 429])("拉流返回 %i：只探一次状态，不换源、不重新取址、不跳歌", async status => {
    vi.useFakeTimers();
    fetchStatus = status;
    const s = usePlayList.getState();
    const audio = s.getAudio();
    usePlayList.setState({
      list: [
        {
          id: "a",
          type: "mv",
          bvid: "BV_a",
          cid: "1",
          title: "a",
          audioUrl: "https://cdn.test/0.m4s",
          audioUrlCandidates: ["https://cdn.test/0.m4s", "https://cdn.test/1.m4s"],
        },
        { id: "b", type: "mv", bvid: "BV_b", cid: "2", title: "b" },
      ],
      playId: "a",
    });
    await vi.advanceTimersByTimeAsync(100);
    audio.src = "https://cdn.test/0.m4s";
    vi.mocked(getPlayerPlayurl).mockClear();
    vi.mocked(getWebInterfaceView).mockClear();
    const load = vi.spyOn(audio, "load");
    (audio as any).error = { code: 2, message: "network" };

    for (let i = 0; i < 3; i += 1) {
      audio.onerror?.(new Event("error") as any);
      await vi.advanceTimersByTimeAsync(5000);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    expect(getPlayerPlayurl).not.toHaveBeenCalled();
    expect(getWebInterfaceView).not.toHaveBeenCalled();
    expect(usePlayList.getState().playId).toBe("a");
    expect(usePlayList.getState().isPlaying).toBe(false);
  });

  test("拉流返回 503 不是限流：照常换到备用地址自救", async () => {
    vi.useFakeTimers();
    fetchStatus = 503;
    const s = usePlayList.getState();
    const audio = s.getAudio();
    usePlayList.setState({
      list: [
        {
          id: "a",
          type: "mv",
          bvid: "BV_a",
          cid: "1",
          title: "a",
          audioUrl: "https://cdn.test/0.m4s",
          audioUrlCandidates: ["https://cdn.test/0.m4s", "https://cdn.test/1.m4s"],
        },
      ],
      playId: "a",
    });
    await vi.advanceTimersByTimeAsync(100);
    audio.src = "https://cdn.test/0.m4s";
    vi.spyOn(audio, "play").mockResolvedValue(undefined as any);
    (audio as any).error = { code: 2, message: "network" };

    audio.onerror?.(new Event("error") as any);
    await vi.advanceTimersByTimeAsync(5000);

    expect(audio.src).toBe("https://cdn.test/1.m4s");
    expect(vi.mocked(addToast).mock.calls.some(([toast]) => toast.title === BILI_RATE_LIMIT_MESSAGE)).toBe(false);
  });

  test("换源后重新取址时被限流：不再查失效、不跳下一首", async () => {
    vi.useFakeTimers();
    fetchStatus = 503;
    const s = usePlayList.getState();
    const audio = s.getAudio();
    usePlayList.setState({
      list: [
        { id: "a", type: "mv", bvid: "BV_a", cid: "1", title: "a", audioUrl: "https://cdn.test/0.m4s" },
        { id: "b", type: "mv", bvid: "BV_b", cid: "2", title: "b" },
      ],
      playId: "a",
    });
    await vi.advanceTimersByTimeAsync(100);
    audio.src = "https://cdn.test/0.m4s";
    vi.mocked(getPlayerPlayurl)
      .mockReset()
      .mockResolvedValue({ code: -412 } as any);
    vi.mocked(getWebInterfaceView).mockClear();
    (audio as any).error = { code: 2, message: "network" };

    audio.onerror?.(new Event("error") as any);
    await vi.advanceTimersByTimeAsync(10000);

    expect(getPlayerPlayurl).toHaveBeenCalledTimes(1);
    expect(getWebInterfaceView).not.toHaveBeenCalled();
    expect(usePlayList.getState().playId).toBe("a");
  });

  test("停手期间播到尾声不预取下一首；用户点播放后恢复正常取址", async () => {
    vi.mocked(getPlayerPlayurl).mockResolvedValueOnce({ code: -352 } as any);
    usePlayList.setState({
      list: [
        { id: "a", type: "mv", bvid: "BV_a", cid: "1", title: "a" },
        { id: "b", type: "mv", bvid: "BV_b", cid: "2", title: "b" },
      ],
      playId: "a",
    });
    await vi.waitFor(() => expect(getPlayerPlayurl).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 50));

    const audio = usePlayList.getState().getAudio();
    Object.defineProperty(audio, "duration", { value: 100, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 95, writable: true, configurable: true });
    audio.ontimeupdate?.(new Event("timeupdate"));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(getPlayerPlayurl).toHaveBeenCalledTimes(1);

    vi.mocked(getPlayerPlayurl).mockResolvedValue(playurlOk("https://cdn.test/a.m4s"));
    vi.spyOn(audio, "play").mockResolvedValue(undefined as any);
    usePlayList.getState().togglePlay();
    await vi.waitFor(() => expect(getPlayerPlayurl).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(usePlayList.getState().getPlayItem()?.audioUrl).toBe("https://cdn.test/a.m4s"));
  });
});
