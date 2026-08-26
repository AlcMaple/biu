// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachMediaSourceAudio,
  findFragmentStart,
  findInitSegmentEnd,
  pickAudioMime,
  shouldUseMediaSource,
} from "@/common/utils/media-source";

vi.mock("@/platform", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

/** 伪造一个最小可用的 ManagedMediaSource + SourceBuffer，覆盖挂载/喂流/收尾 */
class FakeSourceBuffer extends EventTarget {
  updating = false;
  readonly appended: ArrayBuffer[] = [];
  buffered = { length: 0, start: () => 0, end: () => 10 };
  appendBuffer(chunk: ArrayBuffer) {
    this.appended.push(chunk);
    this.updating = true;
    // 异步「处理完成」，模拟缓冲增长后触发 updateend
    setTimeout(() => {
      this.updating = false;
      this.buffered = { length: 1, start: () => 0, end: () => 10 };
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
    // 模拟大文件：第一次 append 抛配额超限，驱逐后第二次成功。
    // 播放头必须落在缓冲区内且身后有已播段（这里 20s ∈ [0,30]）——只有这样「驱逐已播缓冲」才真的能腾出空间。
    class QuotaSourceBuffer extends EventTarget {
      updating = false;
      appendCount = 0;
      removeCalls = 0;
      buffered = { length: 1, start: () => 0, end: () => 30 };
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
  it("播放头落在缓冲区之外时不驱逐、直接失败（让调用方尽快回退直连）", async () => {
    // 线上事故的病态状态：带 resumeTime 重新挂载 MSE，播放头被 seek 到 54s，
    // 但 MSE 只从文件头喂到了 13s。此时「驱逐播放头之前的缓冲」会把正在喂的数据自己删掉，
    // 而 WebKit 本就拒收远离播放头的 append —— 重试注定全败，只是白白多沉默十几秒。
    class StrandedSourceBuffer extends EventTarget {
      updating = false;
      appendCount = 0;
      removeCalls = 0;
      buffered = { length: 1, start: () => 0, end: () => 13 };
      appendBuffer() {
        this.appendCount += 1;
        const err = new Error("quota");
        (err as { name?: string }).name = "QuotaExceededError";
        throw err;
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
    const sb = new StrandedSourceBuffer();
    class MS extends EventTarget {
      static isTypeSupported = FakeManagedMediaSource.isTypeSupported;
      readyState = "closed";
      duration = NaN;
      addSourceBuffer() {
        return sb as unknown as SourceBuffer;
      }
      endOfStream() {}
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
    Object.defineProperty(audio, "currentTime", { configurable: true, value: 54 });
    const onError = vi.fn();
    attachMediaSourceAudio(audio, "https://x/media", { onError });
    ms.open();

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    // 一次就放弃：不做 5 轮无用的驱逐重试
    expect(sb.appendCount).toBe(1);
    expect(sb.removeCalls).toBe(0);
  });
});

/** 造一个 [size][type] 的 box，payload 填 0 */
const makeBox = (type: string, payloadLength: number) => {
  const size = 8 + payloadLength;
  const box = new Uint8Array(size);
  new DataView(box.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i += 1) box[4 + i] = type.charCodeAt(i);
  return box;
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
};

describe("fMP4 盒子解析（支撑「从任意位置开始喂」）", () => {
  it("findInitSegmentEnd 返回 ftyp+moov 的结束位置", () => {
    const ftyp = makeBox("ftyp", 16);
    const moov = makeBox("moov", 40);
    const moof = makeBox("moof", 24);
    expect(findInitSegmentEnd(concat(ftyp, moov, moof))).toBe(ftyp.byteLength + moov.byteLength);
  });

  it("没有 moov（不是 fMP4 / 头部被截断）时返回 undefined", () => {
    expect(findInitSegmentEnd(concat(makeBox("ftyp", 16), makeBox("mdat", 40)))).toBeUndefined();
    // size 字段非法：按解析失败处理，不能瞎猜
    const broken = new Uint8Array(16);
    expect(findInitSegmentEnd(broken)).toBeUndefined();
  });

  it("findFragmentStart 只认 moof 紧跟 mdat 的组合，避免撞上音频数据里的巧合", () => {
    const junk = new Uint8Array(32); // 目标偏移落在某个分片中间，前面是半截数据
    const moof = makeBox("moof", 16);
    const mdat = makeBox("mdat", 64);
    expect(findFragmentStart(concat(junk, moof, mdat))).toBe(junk.byteLength);
    // 只有 moof 没有 mdat：不算合法边界
    expect(findFragmentStart(concat(junk, moof, makeBox("free", 64)))).toBeUndefined();
    // 完全不是分片流
    expect(findFragmentStart(new Uint8Array(128))).toBeUndefined();
  });
});

describe("从任意位置开始喂（跳转/中途恢复秒起）", () => {
  /** 造一个可 Range 访问的假 fMP4：ftyp+moov 之后是若干个 moof+mdat 分片 */
  const buildFakeFmp4 = (fragmentCount: number, fragmentPayload: number) => {
    const parts = [makeBox("ftyp", 16), makeBox("moov", 40)];
    for (let i = 0; i < fragmentCount; i += 1) {
      parts.push(makeBox("moof", 16), makeBox("mdat", fragmentPayload));
    }
    return concat(...parts);
  };

  const mountWithRangeServer = (file: Uint8Array, startTime: number, duration: number) => {
    const ranges: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const header = (init?.headers as Record<string, string> | undefined)?.Range;
        ranges.push(header ?? "(no range)");
        if (!header) return new Response(file as unknown as BodyInit, { status: 200 });
        const [rawStart, rawEnd] = header.replace("bytes=", "").split("-");
        const start = Number(rawStart);
        const end = rawEnd === "" ? file.byteLength - 1 : Math.min(Number(rawEnd), file.byteLength - 1);
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: { "content-range": `bytes ${start}-${end}/${file.byteLength}` },
        });
      }),
    );

    const sb = new FakeSourceBuffer();
    class MS extends EventTarget {
      static isTypeSupported = FakeManagedMediaSource.isTypeSupported;
      readyState = "closed";
      duration = NaN;
      addSourceBuffer() {
        return sb as unknown as SourceBuffer;
      }
      endOfStream() {}
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

    const audio = new Audio();
    const onError = vi.fn();
    attachMediaSourceAudio(audio, "https://x/media", { startTime, duration, onError });
    ms.open();
    return { audio, onError, ranges, sb };
  };

  it("跳到中段时用 Range 从目标片段取流，而不是从头下载", async () => {
    // 3.3MB / 200s，确保扫描窗口远不到文件尾，真正走「定位 → 续流」的完整快路径
    const file = buildFakeFmp4(400, 8 * 1024);
    const { onError, ranges, sb } = mountWithRangeServer(file, 120, 200);

    await vi.waitFor(() => expect(ranges.length).toBeGreaterThanOrEqual(3));
    expect(onError).not.toHaveBeenCalled();

    // 1) 取文件头解析 init 段
    expect(ranges[0]).toBe("bytes=0-131071");
    // 2) 按「已知时长 + 文件总大小」的比例跳到目标附近扫 moof 边界。
    //    故意比目标早 8 秒（SEEK_UNDERSHOOT）：宁可落在目标之前，也不要跳过头。
    const scanStart = Number(ranges[1].replace("bytes=", "").split("-")[0]);
    const expectedScanStart = 72 + Math.floor(((120 - 8) / 200) * (file.byteLength - 72));
    expect(scanStart).toBe(expectedScanStart);
    // 3) 续流从扫描窗口末尾接上，且不越过文件尾
    const streamStart = Number(ranges[2].replace("bytes=", "").split("-")[0]);
    expect(streamStart).toBe(scanStart + 256 * 1024);
    expect(streamStart).toBeLessThan(file.byteLength);

    // 定位时顺手多读的那几百 KB 必须切片喂，不能变成一次巨型 append（那正是撑爆配额的老毛病）
    await vi.waitFor(() => expect(sb.appended.length).toBeGreaterThan(5));
    const oversized = sb.appended.filter(chunk => chunk.byteLength > 64 * 1024);
    expect(oversized).toHaveLength(0);
  });

  it("跳到接近末尾时不发越界 Range（真实服务端会回 416）", async () => {
    // 小文件：扫描窗口一口气读到文件尾，此时不该再请求 `bytes=<文件大小>-`
    const file = buildFakeFmp4(60, 8 * 1024);
    const { onError, ranges } = mountWithRangeServer(file, 190, 200);

    await vi.waitFor(() => expect(ranges.length).toBeGreaterThanOrEqual(2));
    // 给可能多发的请求留出时间窗，确认确实没有第三次
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(ranges).toHaveLength(2);
    for (const range of ranges) {
      const start = Number(range.replace("bytes=", "").split("-")[0]);
      expect(start).toBeLessThan(file.byteLength);
    }
    expect(onError).not.toHaveBeenCalled();
  });

  it("服务端不支持 Range（回 200）时退回顺序喂，不报错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(buildFakeFmp4(4, 1024) as unknown as BodyInit, { status: 200 })),
    );
    const sb = new FakeSourceBuffer();
    class MS extends EventTarget {
      static isTypeSupported = FakeManagedMediaSource.isTypeSupported;
      readyState = "closed";
      duration = NaN;
      addSourceBuffer() {
        return sb as unknown as SourceBuffer;
      }
      endOfStream() {}
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

    const audio = new Audio();
    const onError = vi.fn();
    attachMediaSourceAudio(audio, "https://x/media", { startTime: 120, duration: 200, onError });
    ms.open();

    // 快路径失效只降级成「从头顺序喂 + 延迟 seek」，不能变成播放失败
    await vi.waitFor(() => expect(sb.appended.length).toBeGreaterThanOrEqual(1));
    expect(onError).not.toHaveBeenCalled();
  });
});
