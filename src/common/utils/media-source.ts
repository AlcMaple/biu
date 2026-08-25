import { log } from "@/platform";

/**
 * iOS 专用：通过 MSE 逐段喂流播放 B 站的纯音频分片 MP4。
 *
 * 背景：桌面浏览器把「音频 m4s 地址直接塞给 `<audio src>`」当作渐进式文件能正常播；
 * 但 iOS 的 WebKit（iPhone 上所有浏览器都是 WKWebView）对这种「只有音频轨的分片 MP4」
 * 直连播放会挂起/解码失败（实测 code 4 MEDIA_ERR_SRC_NOT_SUPPORTED）。iOS 官方路径是
 * 用 MediaSource 把字节 append 进 SourceBuffer——本模块就做这件事。
 *
 * iPhone 从 iOS 17.1 起提供的是 `ManagedMediaSource`（普通 `MediaSource` 仅 iPad 有），
 * 两者 API 基本一致，这里优先用前者。桌面不走这条路（直连本来就好，无谓增加复杂度）。
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
export const pickAudioMime = (opts: { isDolby?: boolean; isLossless?: boolean }): string | undefined => {
  const ctor = getCtor();
  if (!ctor) return undefined;

  const candidates: string[] = [];
  if (opts.isLossless) candidates.push('audio/mp4; codecs="fLaC"', 'audio/mp4; codecs="flac"');
  else if (opts.isDolby) candidates.push('audio/mp4; codecs="ec-3"', 'audio/mp4; codecs="ac-3"');
  // AAC-LC 是绝大多数普通音质的编码，作为兜底始终尝试
  candidates.push('audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="mp4a.40.5"');

  return candidates.find(type => {
    try {
      return ctor.isTypeSupported(type);
    } catch {
      return false;
    }
  });
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
    isDolby?: boolean;
    isLossless?: boolean;
    onError?: (error: unknown) => void;
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
  // 追加队列：SourceBuffer 一次只能处理一个 append，未完成时新块先排队
  const queue: ArrayBuffer[] = [];
  let streamEnded = false;

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

  const pump = () => {
    if (aborted || !sourceBuffer || sourceBuffer.updating) return;
    const chunk = queue.shift();
    if (chunk) {
      try {
        sourceBuffer.appendBuffer(chunk);
      } catch (error) {
        fail(error);
      }
      return;
    }
    // 队列排空且下载结束：收尾，让浏览器知道时长已定
    if (streamEnded && mediaSource.readyState === "open") {
      try {
        mediaSource.endOfStream();
      } catch {
        /* 已经 ended / 关闭：忽略 */
      }
    }
  };

  const onSourceOpen = async () => {
    if (aborted) return;
    try {
      sourceBuffer = mediaSource.addSourceBuffer(mime);
      sourceBuffer.addEventListener("updateend", pump);

      const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`media fetch failed: ${response.status}`);

      const reader = response.body.getReader();
      // 边读边喂：拿到一块就入队，SourceBuffer 空闲时立即 append，实现快速起播
      for (;;) {
        const { done, value } = await reader.read();
        if (aborted) return;
        if (done) break;
        if (value) {
          queue.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
          pump();
        }
      }
      streamEnded = true;
      pump();
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
