import { addToast } from "@heroui/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { audio, usePlayList } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";

vi.mock("@/platform/web-log-transport", () => ({ reportWebLog: vi.fn(), installWebLogTransport: vi.fn() }));
vi.mock("@heroui/react", () => ({ addToast: vi.fn() }));
vi.mock("@/common/utils/audio", async importOriginal => ({
  ...(await importOriginal<typeof import("@/common/utils/audio")>()),
  isUrlValid: (url: string | undefined) => Boolean(url),
}));

let stream: ReadableStreamDefaultController<Uint8Array>;
const requests = vi.fn(
  async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start: c => {
          stream = c;
        },
      }),
    ),
);
let getSource: () => EventTarget & { duration: number };
const play = (id: string) => {
  usePlayList.setState({
    list: [{ id, type: "audio", sid: 11, title: id, duration: 123, audioUrl: "/media/" + id }],
    playId: id,
  });
  getSource().dispatchEvent(new Event("sourceopen"));
};
const startMidSong = () => {
  play("one");
  audio.currentTime = 46;
  audio.ontimeupdate?.(new Event("timeupdate"));
  audio.onplaying?.(new Event("playing"));
  expect(audio.src).toMatch(/^blob:/);
  expect(usePlayList.getState().isPlaying).toBe(true);
};
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("iOS 前台播放中断", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone AppleWebKit");
    class FakeMse extends EventTarget {
      duration = NaN;
      static isTypeSupported() {
        return true;
      }
      constructor() {
        super();
        getSource = () => this;
      }
      addSourceBuffer() {
        return { buffered: { length: 0 } };
      }
    }
    vi.stubGlobal("ManagedMediaSource", FakeMse);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:ios-stream");
    vi.stubGlobal("fetch", requests);
    audio.currentTime = 0;
    await usePlayList.getState().init();
  });
  afterEach(() => {
    usePlayList.getState().clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("正常点歌就把已知总时长交给分段播放器，不把缓冲尽头当歌尾", () => {
    play("one");
    expect(getSource().duration).toBe(123);
  });

  test("已开播的流断开时，直连从断点而不是起点继续", async () => {
    startMidSong();
    stream.error(new TypeError("Load failed"));
    await settle();
    expect(audio.src).toBe("/media/one");
    audio.currentTime = 0;
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(46);
    expect(audio.paused).toBe(false);
  });

  test("没有 waiting/stalled 也能续播；直连仍不走则显示播放，点击从断点重新挂载", async () => {
    startMidSong();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(audio.src).toBe("/media/one");
    expect(audio.paused).toBe(false);
    audio.currentTime = 0;
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(46);
    audio.onplaying?.(new Event("playing"));
    await vi.advanceTimersByTimeAsync(36_000);
    expect(audio.paused).toBe(true);
    expect(usePlayList.getState().isPlaying).toBe(false);
    expect(navigator.mediaSession.playbackState).toBe("paused");
    expect(usePlayProgress.getState().currentTime).toBe(46);
    expect(usePlayList.getState().playId).toBe("one");
    expect(requests).toHaveBeenCalledTimes(1);
    await usePlayList.getState().togglePlay();
    expect(audio.src).toMatch(/^blob:/);
    expect(audio.paused).toBe(false);
  });

  test("弱网缓冲还在涨时先等，一旦进度恢复就不重载", async () => {
    startMidSong();
    stream.enqueue(new Uint8Array(100));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(audio.src).toMatch(/^blob:/);
    audio.currentTime += 1;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(audio.paused).toBe(false);
    expect(audio.src).toMatch(/^blob:/);
  });

  test("进度在走时保持原流；暂停后网络失败也不会被自动唤醒", async () => {
    startMidSong();
    for (let i = 0; i < 3; i++) {
      audio.currentTime += 10;
      await vi.advanceTimersByTimeAsync(12_000);
      expect(audio.src).toMatch(/^blob:/);
    }
    await usePlayList.getState().togglePlay();
    stream.error(new TypeError("Load failed"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(audio.paused).toBe(true);
    expect(usePlayList.getState().isPlaying).toBe(false);
  });

  test("系统已停播但漏掉 pause 事件时，同步按钮且不主动开播", async () => {
    startMidSong();
    const onpause = audio.onpause;
    audio.onpause = null;
    try {
      audio.pause();
      expect(usePlayList.getState().isPlaying).toBe(true);
      await vi.advanceTimersByTimeAsync(24_000);
      expect(usePlayList.getState().isPlaying).toBe(false);
      expect(navigator.mediaSession.playbackState).toBe("paused");
    } finally {
      audio.onpause = onpause;
    }
  });

  test("旧歌等待直连定位时切歌，旧的 loadedmetadata 不会把新歌跳走", async () => {
    startMidSong();
    stream.error(new TypeError("Load failed"));
    await settle();
    expect(audio.src).toBe("/media/one");
    play("two");
    audio.currentTime = 0;
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(0);
    expect(usePlayList.getState().playId).toBe("two");
  });

  test.each([429, 503])("分段请求返回 %i 时暂停，不自动再请求同一地址", async status => {
    requests.mockResolvedValueOnce(new Response(null, { status }));
    play("one");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(usePlayList.getState().isPlaying).toBe(false);
    expect(audio.paused).toBe(true);
    expect(requests).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(addToast)
        .mock.calls.some(([toast]) => toast.title?.toString().includes(status === 429 ? "限流" : "503")),
    ).toBe(true);
  });
});
