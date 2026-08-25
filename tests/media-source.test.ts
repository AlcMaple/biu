// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { attachMediaSourceAudio, pickAudioMime, shouldUseMediaSource } from "@/common/utils/media-source";

vi.mock("@/platform", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

/** 伪造一个最小可用的 ManagedMediaSource + SourceBuffer，覆盖挂载/喂流/收尾 */
class FakeSourceBuffer extends EventTarget {
  updating = false;
  readonly appended: ArrayBuffer[] = [];
  buffered = { length: 0, end: () => 10 };
  appendBuffer(chunk: ArrayBuffer) {
    this.appended.push(chunk);
    this.updating = true;
    // 异步「处理完成」，模拟缓冲增长后触发 updateend
    setTimeout(() => {
      this.updating = false;
      this.buffered = { length: 1, end: () => 10 };
      this.dispatchEvent(new Event("updateend"));
    }, 0);
  }
}

class FakeManagedMediaSource extends EventTarget {
  static supported = new Set([
    'audio/mp4; codecs="mp4a.40.2"',
    'audio/mp4; codecs="mp4a.40.5"',
    'audio/mp4; codecs="fLaC"',
    "audio/mp4",
  ]);
  static isTypeSupported(type: string) {
    return FakeManagedMediaSource.supported.has(type);
  }
  readyState = "closed";
  duration = NaN;
  readonly buffers: FakeSourceBuffer[] = [];
  endOfStreamCalls = 0;
  addSourceBuffer(type: string) {
    void type;
    const sb = new FakeSourceBuffer();
    this.buffers.push(sb);
    return sb as unknown as SourceBuffer;
  }
  endOfStream() {
    this.endOfStreamCalls += 1;
  }
  // 由测试驱动：模拟浏览器打开 source
  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("sourceopen"));
  }
}

const setUA = (ua: string, maxTouchPoints = 0) => {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: maxTouchPoints });
};

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/151 Mobile/15E148";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setUA(DESKTOP_UA, 0);
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "ManagedMediaSource");
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "MediaSource");
});

describe("shouldUseMediaSource", () => {
  it("仅在 iOS WebKit + 存在 MediaSource + http(s) 地址时为真", () => {
    (window as unknown as Record<string, unknown>).ManagedMediaSource = FakeManagedMediaSource;

    setUA(IPHONE_UA);
    expect(shouldUseMediaSource("https://x/media")).toBe(true);
    expect(shouldUseMediaSource("/__biu_proxy/bilibili/media/abc")).toBe(true);
    expect(shouldUseMediaSource("blob:xyz")).toBe(false);

    setUA(DESKTOP_UA);
    expect(shouldUseMediaSource("https://x/media")).toBe(false);
  });

  it("桌面没有 MediaSource / 非 iOS 时为假", () => {
    setUA(DESKTOP_UA);
    expect(shouldUseMediaSource("https://x/media")).toBe(false);
  });
});

describe("pickAudioMime", () => {
  it("无损优先 fLaC，其余回退到支持的 AAC", () => {
    (window as unknown as Record<string, unknown>).ManagedMediaSource = FakeManagedMediaSource;
    expect(pickAudioMime({ isLossless: true })).toBe('audio/mp4; codecs="fLaC"');
    expect(pickAudioMime({})).toBe('audio/mp4; codecs="mp4a.40.2"');
  });

  it("没有 MediaSource 时返回 undefined", () => {
    expect(pickAudioMime({})).toBeUndefined();
  });

  it("优先使用流的真实编码（避免声明与实际不符导致解析失败）", () => {
    (window as unknown as Record<string, unknown>).ManagedMediaSource = FakeManagedMediaSource;
    // 即便 mp4a.40.2 也被支持，也应优先选真实的 mp4a.40.5
    expect(pickAudioMime({ audioCodecs: "mp4a.40.5" })).toBe('audio/mp4; codecs="mp4a.40.5"');
    // 小写 flac 纠正为大小写敏感的 fLaC
    expect(pickAudioMime({ audioCodecs: "flac", isLossless: true })).toBe('audio/mp4; codecs="fLaC"');
  });
});

describe("attachMediaSourceAudio", () => {
  it("挂载后整段 append，完成后调用 endOfStream", async () => {
    const instances: FakeManagedMediaSource[] = [];
    const Ctor = function (this: unknown) {
      const inst = new FakeManagedMediaSource();
      instances.push(inst);
      return inst;
    } as unknown as new () => FakeManagedMediaSource;
    (Ctor as unknown as { isTypeSupported: (t: string) => boolean }).isTypeSupported =
      FakeManagedMediaSource.isTypeSupported;
    (window as unknown as Record<string, unknown>).ManagedMediaSource = Ctor;
    setUA(IPHONE_UA);

    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:fake", revokeObjectURL: () => undefined });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 })),
    );

    const audio = new Audio();
    const onError = vi.fn();
    const onProgress = vi.fn();
    const controller = attachMediaSourceAudio(audio, "https://x/media", { onError, onProgress });
    expect(controller).toBeDefined();

    // 模拟浏览器打开 MediaSource
    instances[0].open();

    // 等待整段下载 + 一次性 append 完成
    await vi.waitFor(() => {
      expect(instances[0].buffers[0]?.appended.length).toBe(1);
      expect(instances[0].endOfStreamCalls).toBe(1);
    });
    expect(onError).not.toHaveBeenCalled();
    // 流式下载期间应上报进度，最终累计到全部字节
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.at(-1)?.[0]).toBe(5);
  });

  it("fetch 失败时回调 onError", async () => {
    const instances: FakeManagedMediaSource[] = [];
    const Ctor = function (this: unknown) {
      const inst = new FakeManagedMediaSource();
      instances.push(inst);
      return inst;
    } as unknown as new () => FakeManagedMediaSource;
    (Ctor as unknown as { isTypeSupported: (t: string) => boolean }).isTypeSupported =
      FakeManagedMediaSource.isTypeSupported;
    (window as unknown as Record<string, unknown>).ManagedMediaSource = Ctor;
    setUA(IPHONE_UA);
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:fake", revokeObjectURL: () => undefined });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    const audio = new Audio();
    const onError = vi.fn();
    attachMediaSourceAudio(audio, "https://x/media", { onError });
    instances[0].open();

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it("append 触发 QuotaExceededError 时先驱逐再重试，不直接失败", async () => {
    // 模拟大文件：第一次 append 抛配额超限，驱逐后第二次成功——正是「ありきたりなさよなら」的场景
    class QuotaSourceBuffer extends EventTarget {
      updating = false;
      appendCount = 0;
      removeCalls = 0;
      buffered = { length: 1, start: () => 0, end: () => 8 };
      appendBuffer() {
        this.appendCount += 1;
        if (this.appendCount === 1) {
          const err = new Error("quota");
          (err as { name?: string }).name = "QuotaExceededError";
          throw err;
        }
        this.updating = true;
        setTimeout(() => {
          this.updating = false;
          this.dispatchEvent(new Event("updateend"));
        }, 0);
      }
      remove() {
        this.removeCalls += 1;
        this.updating = true;
        setTimeout(() => {
          this.updating = false;
          this.dispatchEvent(new Event("updateend"));
        }, 0);
      }
    }
    const sb = new QuotaSourceBuffer();
    class MS extends EventTarget {
      static isTypeSupported = FakeManagedMediaSource.isTypeSupported;
      readyState = "closed";
      duration = NaN;
      endOfStreamCalls = 0;
      addSourceBuffer() {
        return sb as unknown as SourceBuffer;
      }
      endOfStream() {
        this.endOfStreamCalls += 1;
      }
      open() {
        this.readyState = "open";
        this.dispatchEvent(new Event("sourceopen"));
      }
    }
    const ms = new MS();
    (window as unknown as Record<string, unknown>).ManagedMediaSource = function () {
      return ms;
    };
    (
      (window as unknown as Record<string, unknown>).ManagedMediaSource as unknown as {
        isTypeSupported: (t: string) => boolean;
      }
    ).isTypeSupported = FakeManagedMediaSource.isTypeSupported;
    setUA(IPHONE_UA);
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:fake", revokeObjectURL: () => undefined });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 })),
    );

    const audio = new Audio();
    Object.defineProperty(audio, "currentTime", { configurable: true, value: 20 });
    const onError = vi.fn();
    attachMediaSourceAudio(audio, "https://x/media", { onError });
    ms.open();

    // 配额报错后应驱逐并重试成功，而非回调 onError
    await vi.waitFor(() => {
      expect(sb.removeCalls).toBeGreaterThanOrEqual(1);
      expect(sb.appendCount).toBeGreaterThanOrEqual(2);
    });
    expect(onError).not.toHaveBeenCalled();
  });
});
