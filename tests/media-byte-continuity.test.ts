import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { attachMediaSourceAudio, MediaFetchError } from "@/common/utils/media-source";

vi.mock("@/platform", () => ({ log: { warn: vi.fn() } }));

const data = Uint8Array.from({ length: 2 * 65536 + 97 }, (_, i) => (i * 11) % 251);
const cut = 65536 + 17;
const tag = '"audio-v1"';
const ranges: string[] = [];
const ifRanges: (string | null)[] = [];
const signals: AbortSignal[] = [];

function partial(start: number, value = data.slice(start), headers: Record<string, string> = {}) {
  return new Response(value, {
    status: 206,
    headers: { "Content-Range": `bytes ${start}-${data.length - 1}/${data.length}`, ETag: tag, ...headers },
  });
}

async function mount(
  opts: {
    firstHeaders?: Record<string, string>;
    repair?: (start: number, n: number) => Promise<Response> | Response;
  } = {},
) {
  const appended: Uint8Array[] = [];
  const progress = vi.fn();
  const eos = vi.fn();
  const failed = vi.fn();
  let openSource!: () => void;
  let first!: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
  class MS extends EventTarget {
    static isTypeSupported() {
      return true;
    }
    readyState = "open";
    endOfStream = eos;
    constructor() {
      super();
      openSource = () => this.dispatchEvent(new Event("sourceopen"));
    }
    addSourceBuffer() {
      const sb = Object.assign(new EventTarget(), {
        buffered: { length: 1, start: () => 0, end: () => 11 },
        appendBuffer(bytes: Uint8Array) {
          appended.push(bytes.slice());
          queueMicrotask(() => sb.dispatchEvent(new Event("updateend")));
        },
      });
      return sb;
    }
  }
  vi.stubGlobal("ManagedMediaSource", MS);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const h = new Headers(init.headers);
      ranges.push(h.get("range") ?? "initial");
      ifRanges.push(h.get("if-range"));
      const signal = init.signal!;
      signals.push(signal);
      if (ranges.length === 1) {
        return new Response(
          new ReadableStream<Uint8Array<ArrayBuffer>>({
            start(c) {
              first = c;
              signal.addEventListener("abort", () => c.error(new DOMException("cancelled", "AbortError")));
            },
          }),
          { headers: opts.firstHeaders ?? { "Content-Length": String(data.length), ETag: tag } },
        );
      }
      const offset = Number(h.get("range")?.match(/bytes=(\d+)-/)?.[1]);
      return opts.repair ? opts.repair(offset, ranges.length) : partial(offset);
    }),
  );
  const audio = new Audio();
  await audio.play();
  audio.currentTime = 2;
  const controller = attachMediaSourceAudio(audio, "/test-media", { onError: failed, onProgress: progress })!;
  openSource();
  await vi.waitFor(() => expect(ranges).toHaveLength(1));
  first.enqueue(data.slice(0, 65536));
  first.enqueue(data.slice(65536, cut));
  await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith(cut));
  return { first, appended, failed, eos, controller, audio };
}

const flatten = (chunks: Uint8Array[]) => Buffer.concat(chunks);
beforeEach(() => {
  ranges.length = ifRanges.length = signals.length = 0;
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:original-mount");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("iOS 分段播放保留原缓冲续取", () => {
  test.each(["error", "short EOF"])("%s：从未收字节继续，跨 append 边界既不重复也不漏", async kind => {
    const { first, appended, eos, failed, audio } = await mount();
    if (kind === "error") first.error(new TypeError("Load failed"));
    else first.close();
    await vi.waitFor(() => expect(eos).toHaveBeenCalledOnce());
    expect(ranges).toEqual(["initial", `bytes=${cut}-`]);
    expect(ifRanges[1]).toBe(tag);
    expect(Buffer.compare(flatten(appended), data)).toBe(0);
    expect(audio.src).toBe("blob:original-mount");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  test("无长度和版本头时校验接缝，重叠的字节仅播放一次", async () => {
    const { first, appended, eos } = await mount({ firstHeaders: {} });
    first.error(new TypeError("Load failed"));
    await vi.waitFor(() => expect(eos).toHaveBeenCalledOnce());
    expect(ranges).toEqual(["initial", `bytes=${cut - 32}-`]);
    expect(Buffer.compare(flatten(appended), data)).toBe(0);
  });

  test.each(["200", "wrong offset", "changed total", "changed tag", "bad overlap", "encoded range"])(
    "%s：不往同一解码器拼接错误数据",
    async reason => {
      const { first, appended, eos, failed } = await mount({
        firstHeaders: reason === "bad overlap" ? {} : undefined,
        repair: start => {
          if (reason === "200") return new Response(data.slice());
          if (reason === "wrong offset") return partial(start - 1);
          if (reason === "changed total")
            return partial(start, undefined, { "Content-Range": `bytes ${start}-${data.length}/${data.length + 1}` });
          if (reason === "changed tag") return partial(start, undefined, { ETag: '"replaced"' });
          if (reason === "encoded range") return partial(start, undefined, { "Content-Encoding": "gzip" });
          const wrong = data.slice(start);
          wrong[15] ^= 1;
          return partial(start, wrong);
        },
      });
      first.error(new TypeError("Load failed"));
      await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
      expect(flatten(appended).length).toBe(65536);
      expect(eos).not.toHaveBeenCalled();
      expect(ranges).toHaveLength(2);
    },
  );

  test.each([412, 429, 503])("续流返回 HTTP %i，原状态交给播放器，不再重试", async status => {
    const { first, failed } = await mount({ repair: () => new Response(null, { status }) });
    first.error(new TypeError("Load failed"));
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(failed.mock.calls[0][0]).toBeInstanceOf(MediaFetchError);
    expect(failed.mock.calls[0][0].status).toBe(status);
    expect(ranges).toHaveLength(2);
  });

  test("短暂延迟后自行送到时保持单连接", async () => {
    vi.useFakeTimers();
    const { first, appended, eos } = await mount();
    await vi.advanceTimersByTimeAsync(2500);
    first.enqueue(data.slice(cut));
    first.close();
    await vi.waitFor(() => expect(eos).toHaveBeenCalledOnce());
    expect(ranges).toEqual(["initial"]);
    expect(Buffer.compare(flatten(appended), data)).toBe(0);
  });

  test("旧连接挂起时，在缓冲耗尽前撤销旧读并接上新字节", async () => {
    vi.useFakeTimers();
    const { appended, eos, audio } = await mount();
    await vi.advanceTimersByTimeAsync(5500);
    expect(signals[0].aborted).toBe(true);
    expect(eos).toHaveBeenCalledOnce();
    expect(ranges).toEqual(["initial", `bytes=${cut}-`]);
    expect(Buffer.compare(flatten(appended), data)).toBe(0);
    expect(audio.src).toBe("blob:original-mount");
  });

  test("断网后第一次续接仍失败，网络恢复后从同一字节接上", async () => {
    vi.useFakeTimers();
    const { first, appended, failed, eos } = await mount({
      repair: (start, n) => (n === 2 ? Promise.reject(new TypeError("offline")) : partial(start)),
    });
    first.error(new TypeError("offline"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(ranges).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ranges).toEqual(["initial", `bytes=${cut}-`, `bytes=${cut}-`]);
    expect(eos).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
    expect(Buffer.compare(flatten(appended), data)).toBe(0);
  });

  test("编码传输的解码后字节数不当作网络 Range 偏移", async () => {
    const { first, failed, eos } = await mount({ firstHeaders: { "Content-Encoding": "gzip" } });
    first.error(new TypeError("Load failed"));
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(ranges).toHaveLength(1);
    expect(eos).not.toHaveBeenCalled();
  });

  test("两次续接均断网就交还原来的回退分支", async () => {
    vi.useFakeTimers();
    const { first, failed, eos } = await mount({ repair: () => Promise.reject(new TypeError("offline")) });
    first.error(new TypeError("offline"));
    await vi.advanceTimersByTimeAsync(6000);
    expect(ranges).toHaveLength(3);
    expect(failed).toHaveBeenCalledOnce();
    expect(eos).not.toHaveBeenCalled();
  });

  test.each(["切歌", "暂停"])("%s发生在第二次续接前：不再取流", async action => {
    vi.useFakeTimers();
    const { first, controller, audio, eos } = await mount({ repair: () => Promise.reject(new TypeError("offline")) });
    first.error(new TypeError("offline"));
    await vi.advanceTimersByTimeAsync(100);
    expect(ranges).toHaveLength(2);
    if (action === "切歌") controller.abort();
    else audio.pause();
    await vi.advanceTimersByTimeAsync(6000);
    expect(ranges).toHaveLength(2);
    expect(eos).not.toHaveBeenCalled();
  });
});
