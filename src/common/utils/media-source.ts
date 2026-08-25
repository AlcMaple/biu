import { log } from "@/platform";

/**
 * iOS 专用：通过 MSE 分段流式喂流播放 B 站的纯音频流（DASH audio baseUrl，本质是分片 MP4）。
 *
 * 为什么要 MSE（而不是直接 `audio.src = url`）：
 * - iOS 原生 `<audio>` 直连其实**能**播这条流（前提是代理把 Content-Type 发成 audio/mp4；
 *   早先发 application/octet-stream + nosniff 时才会报 code 4 拒绝解码，那是代理的锅，已修）。
 * - 但原生直连在 iOS 上起播前会缓冲一大段，**前摇很长**；大文件（8MB+）经手机隧道甚至缓冲
 *   超过看门狗超时被判死。这正是 bilibili 网页也用 MSE 的原因：只抓头部一小段就起播，
 *   其余边播边下 —— 近乎秒播。本模块就复刻这套「分段喂 + 严格缓冲窗口 + 驱逐已播」的做法。
 *
 * iPhone 从 iOS 17.1 起提供的是 `ManagedMediaSource`（普通 `MediaSource` 仅 iPad 有），
 * 两者 API 基本一致，这里优先用前者。它的 SourceBuffer 配额很小，所以必须把缓冲窗口卡死
 * 在配额之下（见下方 FORWARD_TARGET_SECONDS / 驱逐逻辑），否则 append 会 QuotaExceededError。
 * 桌面不走这条路（直连本来就好、前摇也短，无谓增加复杂度）。
 */

interface ManagedMediaSourceLike extends EventTarget {
  readonly sourceBuffers: SourceBufferList;
  readonly readyState: string;
  duration: number;
  addSourceBuffer(type: string): SourceBuffer;
  endOfStream(reason?: string): void;
}

interface ManagedMediaSourceCtor {
  new (): ManagedMediaSourceLike;
  isTypeSupported(type: string): boolean;
}

type AppleAudioElement = HTMLAudioElement & { disableRemotePlayback?: boolean };

const getCtor = (): ManagedMediaSourceCtor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    ManagedMediaSource?: ManagedMediaSourceCtor;
    MediaSource?: ManagedMediaSourceCtor;
  };
  return w.ManagedMediaSource ?? w.MediaSource;
};

/** iOS / iPadOS 的 WebKit（含 iPhone 上的 Chrome/Edge，都是 WKWebView 套壳） */
export const isAppleMobileWebKit = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ 默认桌面 UA 报成 Macintosh，用触点数区分真桌面
  return /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
};

/**
 * 按音质挑一个 MSE 能解码的 MIME。
 * 注意 FLAC 在 mp4 里的 codecs 串是大小写敏感的 `fLaC`；AAC 用 `mp4a.40.2`；杜比 `ec-3`。
 * 逐个用 isTypeSupported 过滤，全不支持则返回 undefined（调用方回退直连）。
 */
export const pickAudioMime = (opts: {
  audioCodecs?: string;
  isDolby?: boolean;
  isLossless?: boolean;
}): string | undefined => {
  const ctor = getCtor();
  if (!ctor) return undefined;

  const candidates: string[] = [];
  // 最重要：优先用流的真实编码。MSE 声明的 codecs 必须和实际流一致，
  // 否则 appendBuffer 会静默解析失败（buffer 一直是 0，元素卡在 readyState 0）。
  const real = opts.audioCodecs?.trim();
  if (real) {
    // FLAC 在 mp4 里的 codecs 串大小写敏感，B 站接口给的是小写 flac，纠正为 fLaC
    const normalized = real.toLowerCase() === "flac" ? "fLaC" : real;
    candidates.push(`audio/mp4; codecs="${normalized}"`);
  }
  if (opts.isLossless) candidates.push('audio/mp4; codecs="fLaC"', 'audio/mp4; codecs="flac"');
  else if (opts.isDolby) candidates.push('audio/mp4; codecs="ec-3"', 'audio/mp4; codecs="ac-3"');
  // AAC-LC/HE-AAC 是绝大多数普通音质的编码，作为兜底始终尝试；最后再挂一个裸 audio/mp4
  candidates.push('audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="mp4a.40.5"', "audio/mp4");

  // 去重：真实编码常与兜底候选重复（如都是 mp4a.40.2），去掉重复既省一次探测也让日志干净
  const supported = [...new Set(candidates)].map(type => {
    let ok = false;
    try {
      ok = ctor.isTypeSupported(type);
    } catch {
      ok = false;
    }
    return { type, ok };
  });
  // 诊断：把每个候选的支持情况打出来，一次看清 iOS 到底认哪个
  log.warn("[mse] mime 候选支持情况", { supported });
  return supported.find(entry => entry.ok)?.type;
};

/** 只有在 iOS WebKit + 存在 MediaSource + 是可 fetch 的 http(s) 地址时，才走 MSE */
export const shouldUseMediaSource = (url: string): boolean => {
  if (!url || !getCtor() || !isAppleMobileWebKit()) return false;
  return /^https?:\/\//i.test(url) || url.startsWith("/");
};

export interface MediaSourceController {
  /** 中止本次加载并释放资源（切歌/换源时调用） */
  abort(): void;
  /** 本次挂载对应的地址，便于判断是否已被后续切换取代 */
  readonly url: string;
}

/**
 * 把一个音频流地址通过 MSE 挂到 audio 元素上，边下边喂。
 * 失败（MIME 不支持、网络错误、append 报错）时回调 onError，由调用方回退直连或换源。
 */
export function attachMediaSourceAudio(
  audio: HTMLAudioElement,
  url: string,
  opts: {
    audioCodecs?: string;
    isDolby?: boolean;
    isLossless?: boolean;
    onError?: (error: unknown) => void;
    /** 下载进度回调（累计已收字节数）。调用方用它把「还在下载」当作存活信号，避免看门狗误杀大文件 */
    onProgress?: (receivedBytes: number) => void;
  } = {},
): MediaSourceController | undefined {
  const ctor = getCtor();
  const mime = pickAudioMime(opts);
  if (!ctor || !mime) return undefined;

  const controller = new AbortController();
  const mediaSource = new ctor();
  const objectUrl = URL.createObjectURL(mediaSource as unknown as MediaSource);
  let sourceBuffer: SourceBuffer | undefined;
  let aborted = false;

  // ManagedMediaSource 要求关闭远程播放（AirPlay），否则可能不触发 sourceopen
  (audio as AppleAudioElement).disableRemotePlayback = true;

  const fail = (error: unknown) => {
    if (aborted) return;
    cleanup();
    opts.onError?.(error);
  };

  const cleanup = () => {
    aborted = true;
    controller.abort();
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* noop */
    }
  };

  const bufEnd = (sb: SourceBuffer) => (sb.buffered.length ? sb.buffered.end(sb.buffered.length - 1) : 0);

  const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  /** 等一次 SourceBuffer 操作（append/remove）结束 */
  const waitUpdateEnd = (sb: SourceBuffer) =>
    new Promise<void>((resolve, reject) => {
      const onEnd = () => {
        sb.removeEventListener("updateend", onEnd);
        sb.removeEventListener("error", onErr);
        resolve();
      };
      const onErr = () => {
        sb.removeEventListener("updateend", onEnd);
        sb.removeEventListener("error", onErr);
        reject(new Error("sourcebuffer error"));
      };
      sb.addEventListener("updateend", onEnd, { once: true });
      sb.addEventListener("error", onErr, { once: true });
    });

  const isQuotaError = (e: unknown) => (e as { name?: string })?.name === "QuotaExceededError";

  /** 驱逐已播过的缓冲（currentTime 之前留一小段），把内存/配额压回去 */
  const evictBehind = async (sb: SourceBuffer, keepBehind: number) => {
    const start = sb.buffered.length ? sb.buffered.start(0) : 0;
    const removeEnd = audio.currentTime - keepBehind;
    if (removeEnd <= start + 0.5) return;
    try {
      sb.remove(start, removeEnd);
      await waitUpdateEnd(sb);
    } catch {
      /* 驱逐失败不致命，忽略 */
    }
  };

  /** append 一段，遇配额超限就先驱逐再重试（标准 MSE 配额处理），每次留得更少、逼出更多空间 */
  const appendChunk = async (sb: SourceBuffer, data: Uint8Array) => {
    const keepBehindByAttempt = [8, 4, 2, 1, 0.5];
    for (let attempt = 0; attempt < keepBehindByAttempt.length; attempt += 1) {
      try {
        sb.appendBuffer(data as unknown as BufferSource);
        await waitUpdateEnd(sb);
        return;
      } catch (e) {
        // 配额满：驱逐播放位置之前的缓冲后重试（这正是整段/过量 append 触发 QuotaExceededError 的解法）
        if (isQuotaError(e) && audio.currentTime > 1) {
          await evictBehind(sb, keepBehindByAttempt[attempt]);
          continue;
        }
        throw e;
      }
    }
    throw new Error("append 反复配额超限");
  };

  const onSourceOpen = async () => {
    if (aborted) return;
    try {
      log.warn("[mse] sourceopen，开始分段流式喂流（bilibili 式：先起播，后台续下）", { mime });
      sourceBuffer = mediaSource.addSourceBuffer(mime);
      const sb = sourceBuffer;

      const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if ((!response.ok && response.status !== 206) || !response.body) {
        throw new Error(`media fetch failed: ${response.status}`);
      }
      const reader = response.body.getReader();

      // 分段策略：小片喂（~64KB，约 5 秒音频），粒度细才能把总缓冲严格压在配额之下。
      // iPhone 的 ManagedMediaSource 配额很小：一个 256KB 的 append 就能解码出 ~20 秒音频，
      // 两三个就撑爆配额，而此时播放位置还在 0、身后没东西可驱逐 —— 这正是「播几秒断音」的根因。
      const APPEND_THRESHOLD = 64 * 1024;
      // 严格的缓冲窗口：只在「播放位置之后 12 秒内」保留缓冲，身后只留 5 秒。
      // 总驻留 ≈ 17 秒，稳稳低于配额（实测单个 256KB append 就有 ~21 秒，配额本身很小）；
      // 起播只需几秒缓冲，所以依然接近秒播。
      const FORWARD_TARGET_SECONDS = 12;
      const KEEP_BEHIND_SECONDS = 5;

      // ManagedMediaSource 的 streaming 事件在本机并不能及时阻止超配额（实测仍报 quota），
      // 因此改为「主动把缓冲窗口卡死在配额以下」：喂之前先驱逐已播段，再等到前向缓冲
      // 掉到目标窗口内才继续喂。播放消耗 → 腾出空间 → 再喂，循环维持一个很小的驻留窗口。
      const makeRoom = async () => {
        for (;;) {
          if (aborted) return;
          await evictBehind(sb, KEEP_BEHIND_SECONDS);
          if (aborted) return;
          // 前向缓冲还没超过目标，就有空间可以继续喂
          if (bufEnd(sb) - audio.currentTime <= FORWARD_TARGET_SECONDS) return;
          // 超前太多：等播放消耗一点再回来（此时不 append，避免撑配额）
          await delay(250);
        }
      };

      let received = 0;
      let firstAppendLogged = false;
      let pending: Uint8Array[] = [];
      let pendingBytes = 0;

      const flushPending = async () => {
        if (pendingBytes === 0) return;
        const merged = new Uint8Array(pendingBytes);
        let off = 0;
        for (const c of pending) {
          merged.set(c, off);
          off += c.byteLength;
        }
        pending = [];
        pendingBytes = 0;
        await makeRoom();
        if (aborted) return;
        await appendChunk(sb, merged);
        if (!firstAppendLogged) {
          firstAppendLogged = true;
          log.warn("[mse] 首段已喂入，可起播", { bufferedEnd: Math.round(bufEnd(sb) * 100) / 100 });
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (aborted) return;
        if (done) break;
        if (value) {
          pending.push(value);
          pendingBytes += value.byteLength;
          received += value.byteLength;
          opts.onProgress?.(received);
        }
        if (pendingBytes >= APPEND_THRESHOLD) {
          await flushPending();
          if (aborted) return;
        }
      }

      await flushPending();
      if (aborted) return;
      if (mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch {
          /* 已 ended：忽略 */
        }
      }
      log.warn("[mse] 全部喂入完成", { totalBytes: received, bufferedEnd: Math.round(bufEnd(sb) * 100) / 100 });
    } catch (error) {
      // AbortError 是我们自己在切歌时中止的，不算失败
      if ((error as { name?: string })?.name === "AbortError") return;
      log.warn("[mse] 音频 MSE 加载失败", { url, error: String(error) });
      fail(error);
    }
  };

  mediaSource.addEventListener("sourceopen", onSourceOpen, { once: true });
  audio.src = objectUrl;

  return {
    url,
    abort: cleanup,
  };
}
