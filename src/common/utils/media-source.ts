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

/* ------------------------------------------------------------------ *
 * 分片 MP4 的最小盒子解析：用来支持「从任意位置开始喂」
 *
 * MSE 只能顺序喂，本身没有 seek 能力。要让跳转/中途恢复也能秒起，必须自己算出
 * 目标时间对应的字节偏移，再用 HTTP Range 从那里拉流。fMP4 的结构是自描述的
 * （每个 box 都是 [size:4][type:4]），所以不依赖 DASH 的 sidx 也能做到：
 *   1) 取文件头一小段，顺序走 box 找到 ftyp+moov 的结束位置 = init segment；
 *   2) 用码率把目标时间估算成字节偏移（故意往前留余量，宁可早一点）；
 *   3) 从该偏移取一小段，扫描到第一个合法的 moof 边界，从那里开始喂。
 * 估算不准没关系：真正的落点由 `sb.buffered` 决定，seek 也以它为准（见 applyPendingSeek）。
 * ------------------------------------------------------------------ */

const readUint32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

const isBoxType = (bytes: Uint8Array, offset: number, type: string) =>
  bytes[offset] === type.charCodeAt(0) &&
  bytes[offset + 1] === type.charCodeAt(1) &&
  bytes[offset + 2] === type.charCodeAt(2) &&
  bytes[offset + 3] === type.charCodeAt(3);

/**
 * 顺序走 box，返回 init segment（ftyp…moov 结束）的字节长度。
 * 遇到 moof/mdat 说明媒体数据开始了；解析不出（不是 fMP4、或头部被截断）返回 undefined。
 */
export const findInitSegmentEnd = (head: Uint8Array): number | undefined => {
  let offset = 0;
  let sawMoov = false;
  while (offset + 8 <= head.length) {
    const size = readUint32(head, offset);
    // size 为 0（延伸到文件尾）或 1（64 位大 box）都不该出现在 init 段里，按解析失败处理
    if (size < 8) return undefined;
    if (isBoxType(head, offset + 4, "moof") || isBoxType(head, offset + 4, "mdat")) {
      return sawMoov ? offset : undefined;
    }
    if (isBoxType(head, offset + 4, "moov")) sawMoov = true;
    offset += size;
  }
  // 头部这一小段里还没走到媒体数据：moov 已完整读到就认，否则要更大的窗口
  return sawMoov && offset <= head.length ? offset : undefined;
};

/**
 * 在一段字节里找到第一个合法的 moof 边界，返回它相对于这段字节起点的偏移。
 * 校验方式是「moof 的下一个 box 必须是 mdat」——这个组合在音频数据里几乎不可能偶然撞上。
 */
export const findFragmentStart = (chunk: Uint8Array): number | undefined => {
  for (let i = 0; i + 16 <= chunk.length; i += 1) {
    if (!isBoxType(chunk, i + 4, "moof")) continue;
    const moofSize = readUint32(chunk, i);
    if (moofSize < 8 || i + moofSize + 8 > chunk.length) continue;
    if (!isBoxType(chunk, i + moofSize + 4, "mdat")) continue;
    return i;
  }
  return undefined;
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
    /** 从这个时间点开始播（秒）。>0 时用 HTTP Range 直接从对应字节偏移取流，实现跳转秒起 */
    startTime?: number;
    /** 音频码率（bps），把 startTime 估算成字节偏移用（次选） */
    bandwidth?: number;
    /** 歌曲总时长（秒）。配合响应里的文件总大小换算偏移，比码率更准（首选） */
    duration?: number;
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

  /**
   * 播放头是否落在已喂入的区间内。
   *
   * MSE 从文件头顺序喂，正常情况下播放头永远在缓冲区里。一旦它跑到缓冲区之外
   * （典型原因：带 resumeTime 的重新挂载、或往前拖到还没喂到的位置），下面所有
   * 「相对播放头」的计算都会反过来伤害自己：节流闸门恒开、驱逐删掉正在喂的数据、
   * WebKit 拒收远离播放头的 append。所以这些逻辑必须先确认播放头是可信的。
   */
  const playheadInsideBuffer = (sb: SourceBuffer) => {
    if (!sb.buffered.length) return false;
    const t = audio.currentTime;
    return t >= sb.buffered.start(0) - 0.1 && t <= bufEnd(sb) + 0.1;
  };

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
    // 播放头不在缓冲区内时，「播放头之前」是个错误的参照系：照它驱逐会把刚喂进去、
    // 还没播到的数据整段删掉。这种状态下什么都不该删。
    if (!playheadInsideBuffer(sb)) return;
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
        // 配额满：驱逐播放位置之前的缓冲后重试（这正是整段/过量 append 触发 QuotaExceededError 的解法）。
        // 但这招只在播放头落在缓冲区内时才成立 —— 否则身后根本没有可释放的东西，
        // 重试 5 次全败只是白白多沉默十几秒，不如立刻失败让调用方回退直连。
        if (isQuotaError(e) && audio.currentTime > 1 && playheadInsideBuffer(sb)) {
          await evictBehind(sb, keepBehindByAttempt[attempt]);
          continue;
        }
        if (isQuotaError(e)) {
          throw new Error(
            `append 被拒且无法驱逐自救（播放头 ${Math.round(audio.currentTime)}s 不在缓冲区 ` +
              `${sb.buffered.length ? `[${Math.round(sb.buffered.start(0))}, ${Math.round(bufEnd(sb))}]` : "空"} 内）`,
          );
        }
        throw e;
      }
    }
    throw new Error("append 反复配额超限");
  };

  /** 头部探测窗口：足够放下 ftyp+moov（音频轨的 moov 通常几 KB） */
  const INIT_PROBE_BYTES = 128 * 1024;
  /** 目标位置附近的扫描窗口：够跨过一个音频分片（通常几十 KB） */
  const FRAGMENT_SCAN_BYTES = 256 * 1024;
  /**
   * 字节偏移估算故意往前留的余量（秒）。宁可落在目标之前一点（多喂几秒就能到），
   * 也不要落在目标之后（那样只能就近起播，用户会觉得"跳过头了"）。
   */
  const SEEK_UNDERSHOOT_SECONDS = 8;

  /** 从 `Content-Range: bytes a-b/total` 里取出文件总大小 */
  const parseTotalSize = (contentRange: string | null) => {
    const total = Number(contentRange?.split("/")[1]);
    return Number.isFinite(total) && total > 0 ? total : undefined;
  };

  const fetchRange = async (start: number, length: number) => {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Range: `bytes=${start}-${start + length - 1}` },
      signal: controller.signal,
    });
    // 服务端忽略 Range 直接回 200 时，拿到的字节和我们算的偏移对不上，必须放弃快路径
    if (response.status !== 206) return undefined;
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      totalSize: parseTotalSize(response.headers.get("content-range")),
    };
  };

  /**
   * 定位 `startTime` 对应的分片起点。成功返回 init 段、媒体起始字节、以及顺手多读的一段数据。
   * 任何一步不成立（不是 fMP4、服务端不支持 Range、扫不到 moof）都返回 undefined，
   * 由调用方退回「顺序喂 + 延迟 seek」。
   */
  const locateFragmentStart = async (startTime: number) => {
    try {
      const head = await fetchRange(0, INIT_PROBE_BYTES);
      if (!head) return undefined;
      const initEnd = findInitSegmentEnd(head.bytes);
      if (initEnd === undefined || initEnd <= 0 || initEnd > head.bytes.length) return undefined;

      // 目标之前留一点余量：宁可落在目标之前（多喂几秒就到），也不要落在之后（只能就近起播）
      const seekFrom = Math.max(0, startTime - SEEK_UNDERSHOOT_SECONDS);
      const duration = opts.duration ?? 0;
      const mediaBytes = head.totalSize ? head.totalSize - initEnd : 0;
      // 首选按「已知时长 + 文件总大小」的比例定位：比码率准，也不依赖接口是否返回码率。
      // 拿不到总大小/时长时退回码率估算；两者都没有就放弃快路径。
      const approxByte =
        duration > 0 && mediaBytes > 0
          ? initEnd + Math.floor((seekFrom / duration) * mediaBytes)
          : (opts.bandwidth ?? 0) > 0
            ? initEnd + Math.floor((seekFrom * (opts.bandwidth ?? 0)) / 8)
            : undefined;
      if (approxByte === undefined) return undefined;
      // 估算落点就在 init 段附近：直接从头顺序喂更简单，也不会更慢
      if (approxByte <= initEnd + FRAGMENT_SCAN_BYTES / 2) return undefined;

      const scan = await fetchRange(approxByte, FRAGMENT_SCAN_BYTES);
      if (!scan) return undefined;
      const relative = findFragmentStart(scan.bytes);
      if (relative === undefined) return undefined;

      return {
        initSegment: head.bytes.subarray(0, initEnd),
        mediaStartByte: approxByte + relative,
        leadingChunk: scan.bytes.subarray(relative),
        totalSize: head.totalSize ?? scan.totalSize,
      };
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") throw error;
      log.warn("[mse] 定位目标片段失败，退回顺序喂", { error: String(error) });
      return undefined;
    }
  };

  const onSourceOpen = async () => {
    if (aborted) return;
    try {
      log.warn("[mse] sourceopen，开始分段流式喂流（bilibili 式：先起播，后台续下）", { mime });
      sourceBuffer = mediaSource.addSourceBuffer(mime);
      const sb = sourceBuffer;

      // ---- 定位：需要从中间开始播时，先取 init 段并把目标时间换算成字节偏移 ----
      const startTime = Math.max(0, opts.startTime ?? 0);
      /**
       * 还没落实的跳转目标。数据喂到覆盖它之前，**绝不**去写 `audio.currentTime` ——
       * 播放头一旦跑到缓冲区之外，节流/驱逐/配额三套逻辑的前提就全塌了（线上无声事故的根因）。
       * 这是整套机制的正确性地板：哪怕 Range 快路径完全失效、退化成从头顺序喂，
       * 也只是「跳转要等久一点」，不会变成「无声且永远回不来」。
       */
      let pendingSeek = startTime;
      const applyPendingSeek = () => {
        if (!pendingSeek || !sb.buffered.length) return;
        const bufferStart = sb.buffered.start(0);
        if (pendingSeek >= bufferStart - 0.1 && pendingSeek <= bufEnd(sb)) {
          audio.currentTime = pendingSeek;
          log.warn("[mse] 跳转目标已缓冲到，落实 seek", { target: Math.round(pendingSeek) });
          pendingSeek = 0;
        } else if (bufferStart > pendingSeek) {
          // 估算落点比目标还靠后：就近从数据实际开始的地方播，不要把播放头留在空区
          audio.currentTime = bufferStart;
          log.warn("[mse] 落点晚于跳转目标，就近起播", {
            target: Math.round(pendingSeek),
            actual: Math.round(bufferStart),
          });
          pendingSeek = 0;
        }
      };

      let mediaStartByte = 0;
      let leadingChunk: Uint8Array | undefined;
      let totalSize = 0;
      if (startTime > 0) {
        const located = await locateFragmentStart(startTime);
        if (located) {
          await appendChunk(sb, located.initSegment);
          mediaStartByte = located.mediaStartByte;
          leadingChunk = located.leadingChunk;
          totalSize = located.totalSize ?? 0;
          log.warn("[mse] 已定位到目标片段，Range 起播", {
            startTime: Math.round(startTime),
            mediaStartByte,
            initBytes: located.initSegment.byteLength,
          });
        } else {
          // 不是分片 MP4 / 服务端不支持 Range / 头部对不上：退回从头顺序喂，
          // 靠 pendingSeek 在数据覆盖到目标时再落实跳转（慢，但不会出错）
          log.warn("[mse] 无法定位目标片段，退回顺序喂 + 延迟 seek", { startTime: Math.round(startTime) });
        }
      }

      const streamFrom = mediaStartByte + (leadingChunk?.byteLength ?? 0);
      // 定位时顺手读的那一段已经到文件尾了（跳到歌曲末尾附近时很常见）：
      // 再发一次 `bytes=<文件大小>-` 是越界请求，真实服务端会回 416，白白掉回直连。
      const alreadyComplete = mediaStartByte > 0 && totalSize > 0 && streamFrom >= totalSize;
      const reader = alreadyComplete
        ? undefined
        : await (async () => {
            const response = await fetch(url, {
              cache: "no-store",
              credentials: "same-origin",
              headers: mediaStartByte > 0 ? { Range: `bytes=${streamFrom}-` } : undefined,
              signal: controller.signal,
            });
            if ((!response.ok && response.status !== 206) || !response.body) {
              throw new Error(`media fetch failed: ${response.status}`);
            }
            return response.body.getReader();
          })();

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
          // 播放头不在缓冲区内：`bufEnd - currentTime` 是负数，闸门会恒开变成无限量喂。
          // 此时改用「缓冲区自身的长度」当窗口，至少不会把配额撑爆。
          if (!playheadInsideBuffer(sb)) {
            const span = sb.buffered.length ? bufEnd(sb) - sb.buffered.start(0) : 0;
            if (span <= FORWARD_TARGET_SECONDS + KEEP_BEHIND_SECONDS) return;
            await delay(250);
            continue;
          }
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
        let offset = 0;
        for (const c of pending) {
          merged.set(c, offset);
          offset += c.byteLength;
        }
        pending = [];
        pendingBytes = 0;
        // 必须按 APPEND_THRESHOLD 切片喂：Range 定位时顺手多读的那一段可能有几百 KB，
        // 一次性 append 就是当初撑爆配额的老毛病（一个 256KB append 能解码出 ~20s 音频）。
        for (let start = 0; start < merged.byteLength; start += APPEND_THRESHOLD) {
          await makeRoom();
          if (aborted) return;
          await appendChunk(sb, merged.subarray(start, Math.min(start + APPEND_THRESHOLD, merged.byteLength)));
          // 每次喂完都看一眼跳转目标是否已被覆盖，覆盖到就立刻落实（跳转的「秒起」就发生在这里）
          applyPendingSeek();
          if (!firstAppendLogged) {
            firstAppendLogged = true;
            log.warn("[mse] 首段已喂入，可起播", { bufferedEnd: Math.round(bufEnd(sb) * 100) / 100 });
          }
        }
      };

      // Range 定位时顺手多读的那一段，直接当作第一块媒体数据喂进去，省掉一次往返
      if (leadingChunk?.byteLength) {
        pending.push(leadingChunk);
        pendingBytes += leadingChunk.byteLength;
        received += leadingChunk.byteLength;
        opts.onProgress?.(received);
        await flushPending();
        if (aborted) return;
      }

      for (; reader; ) {
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
      // 兜底：整段喂完了但目标还没落实（估算严重偏后等），就近开播，别把播放头留在空区
      applyPendingSeek();
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
