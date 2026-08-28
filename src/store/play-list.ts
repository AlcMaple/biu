import { addToast } from "@heroui/react";
import { remove } from "es-toolkit/array";
import { uniqueId } from "es-toolkit/compat";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { getPlayModeList, PlayMode } from "@/common/constants/audio";
import { isOfflineDemo } from "@/common/offline-demo";
import { getAudioUrl, getDashUrl, isResourceGoneCode, isUrlValid } from "@/common/utils/audio";
import { resumeAudioGraph } from "@/common/utils/audio-graph";
import { attachMediaSourceAudio, shouldUseMediaSource, type MediaSourceController } from "@/common/utils/media-source";
import { beginPlayReport, endPlayReport, reportHeartbeat } from "@/common/utils/play-report";
import { isSamePlaybackUrl, normalizePlaybackUrl, sanitizePersistedPlaybackUrls } from "@/common/utils/playback-url";
import { stripHtml } from "@/common/utils/str";
import { formatUrlProtocol } from "@/common/utils/url";
import platform from "@/platform";
import { log } from "@/platform";
import { getAudioSongInfo } from "@/service/audio-song-info";
import { getWebInterfaceView } from "@/service/web-interface-view";
import { isBilibiliMediaProxyUrl } from "@shared/bilibili-web-proxy";

import { useLocalFavItemsStore } from "./local-fav-items";
import { usePlayProgress } from "./play-progress";

export type PlayDataType = "mv" | "audio";

export interface PlayData {
  id: string;
  /** 视频标题 */
  title: string;
  /** 类型 */
  type: PlayDataType;
  /** 视频id */
  bvid?: string;
  /** 音频id */
  sid?: number;
  /** 视频aid,部分视频操作需要，例如收藏 */
  aid?: string;
  /** 视频分集id */
  cid?: string;
  /** 视频封面 */
  cover?: string;
  /** UP name */
  ownerName?: string;
  /** up mid */
  ownerMid?: number;
  /** 是否为多集视频 */
  hasMultiPart?: boolean;
  /** 分集标题 */
  pageTitle?: string;
  /** 分集封面 */
  pageCover?: string;
  /** 分集id */
  pageIndex?: number;
  /** 视频总分集数 */
  totalPage?: number;
  /** 视频时长 单位为秒 */
  duration?: number;
  /** 音频码率（bps）。MSE 用它把跳转目标换算成字节偏移，实现「跳转秒起」 */
  audioBandwidth?: number;
  /** 视频音频url */
  audioUrl?: string;
  /** 候选音频地址（正规源优先、PCDN 兜底），播放失败时自动换源重试 */
  audioUrlCandidates?: string[];
  /** 视频url */
  videoUrl?: string;
  /** 是否为无损音频 */
  isLossless?: boolean;
  /** 是否为杜比音频 */
  isDolby?: boolean;
  /** 音频编码串（如 mp4a.40.2 / mp4a.40.5 / fLaC）。MSE 必须按真实编码声明才能解析 */
  audioCodecs?: string;
  /** 来源 */
  source?: "local" | "online";
  /** 播放量快照（收藏进本地歌单时直接沿用，省去回查 infos） */
  playCount?: number;
  /** 用户自定义歌手（覆盖 ownerName 显示，目前仅作用于精美播放器） */
  customArtist?: string;
}

interface State {
  // 播放/暂停
  isPlaying: boolean;
  // 静音
  isMuted: boolean;
  // 音量 0-1
  volume: number;
  // 播放模式
  playMode: PlayMode;
  // 播放速率（0.5x - 2.0x）
  rate: number;
  // 总时长（秒）
  duration: number | undefined;
  /** 播放队列 */
  list: PlayData[];
  /** 当前播放视频id */
  playId?: string;
  /** 下一个播放视频id */
  nextId?: string;
  /** 是否在随机播放模式下保持视频分集顺序 */
  shouldKeepPagesOrderInRandomPlayMode: boolean;
  /** 随机播放历史栈：游标左侧已播放的歌曲 id 序列 */
  randomHistory: string[];
  /** 随机播放前向队列：游标右侧已探索过（回退后可再前进）的歌曲 id 序列 */
  randomFuture: string[];
  /** 本轮随机已播歌曲 id 集合：用于「播完全部歌曲前不重复」，全部播完后清空开启新一轮 */
  randomPlayedIds: string[];
}

export interface PlayItem {
  type: PlayDataType;
  id?: string;
  source?: "local" | "online";
  audioUrl?: string;
  title: string;
  bvid?: string;
  sid?: number;
  cover?: string;
  ownerName?: string;
  ownerMid?: number;
  /** 目标分集 cid（多P视频时用于直接播放指定分集） */
  cid?: string;
  /** 播放量快照（随歌曲一路带下来，收藏时直接沿用，无需回查 infos） */
  playCount?: number;
  /** 视频/音频时长（秒，收藏时直接沿用，无需重新请求详情） */
  duration?: number;
}

interface Action {
  togglePlay: () => void;
  toggleMute: () => void;
  setVolume: (volume: number) => void; // 0-1
  togglePlayMode: () => void;
  setRate: (rate: number) => void; // 0.5-2.0
  seek: (s: number) => void;
  setShouldKeepPagesOrderInRandomPlayMode: (shouldKeep: boolean) => void;

  init: VoidFunction;
  play: (params: PlayItem) => Promise<void>;
  playListItem: (id: string) => Promise<void>;
  playList: (items: PlayItem[]) => Promise<void>;
  addToNext: (item: PlayItem) => void;
  addList: (items: PlayItem[]) => void;
  delPage: (id: string) => void;
  /** 实现是 async（删当前歌时要等续播链路走完），声明必须如实反映，否则调用方的 await 形同虚设 */
  del: (id: string) => Promise<void>;
  clear: () => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;

  getAudio: () => HTMLAudioElement;
  getPlayItem: () => PlayData | undefined;
  setCustomArtist: (id: string, artist: string | undefined) => void;
  /** 本地歌单重命名后，按曲目身份同步播放队列中的显示标题，避免播放栏/播放队列仍显示旧名 */
  renameTrack: (target: Pick<PlayItem, "type" | "source" | "id" | "bvid" | "sid" | "cid">, newTitle: string) => void;
}

const idGenerator = () => `${Date.now()}${uniqueId()}`;

/** 去重压入：仅当 id 不在数组中时追加（用于维护本轮随机已播集合） */
const pushUnique = (arr: string[], id: string) => {
  if (!arr.includes(id)) {
    arr.push(id);
  }
};

const getMVData = async (bvid: string) => {
  const res = await getWebInterfaceView({ bvid });
  const hasMultiPart = (res?.data?.pages?.length ?? 0) > 1;

  return (
    res?.data?.pages?.map(item => ({
      id: idGenerator(),
      type: "mv" as PlayDataType,
      bvid,
      aid: String(res?.data?.aid),
      cid: String(item.cid),
      title: res?.data?.title,
      cover: formatUrlProtocol(res?.data?.pic),
      ownerName: res?.data?.owner?.name,
      ownerMid: res?.data?.owner?.mid,
      hasMultiPart,
      // 元数据回查本就拉了 stat，顺手带上播放量，收藏时无需再查 infos
      playCount: res?.data?.stat?.view,

      pageIndex: item.page,
      pageTitle: hasMultiPart ? item.part : res?.data?.title,
      pageCover: hasMultiPart
        ? formatUrlProtocol(item.first_frame || res?.data?.pic)
        : formatUrlProtocol(res?.data?.pic),
      totalPage: res?.data?.pages?.length,
      duration: item.duration,
    })) || []
  );
};

const getAudioData = async (sid: number) => {
  const res = await getAudioSongInfo({ sid });

  return [
    {
      id: idGenerator(),
      type: "audio" as PlayDataType,
      sid,
      title: res?.data?.title || "",
      cover: formatUrlProtocol(res?.data?.cover || ""),
      duration: res?.data?.duration || 0,
      ownerName: res?.data?.author || "",
      ownerMid: res?.data?.uid || 0,
    },
  ];
};

/**
 * 同一条提示的最小间隔：换源自救 / 自动跳过在弱网下可能连续触发，
 * 不去重会像刷屏一样连弹十几个 toast（移动端网页尤其明显）。
 */
const TOAST_THROTTLE_MS = 4000;
const lastToastAt = new Map<string, number>();

const toastThrottled = (title: string, color: "danger" | "warning") => {
  const now = Date.now();
  const last = lastToastAt.get(title);
  if (last !== undefined && now - last < TOAST_THROTTLE_MS) return;
  lastToastAt.set(title, now);
  addToast({
    title,
    color,
  });
};

const toastError = (title: string) => {
  toastThrottled(title, "danger");
};

/** 换源等过程性提示：短暂自动消失，不打断使用 */
const toastInfo = (title: string) => {
  toastThrottled(title, "warning");
};

const sanitizeTitle = (title: string) => stripHtml(title);

/**
 * iOS 的 WebKit（iOS 上所有浏览器都是 WKWebView，Chrome 同样受影响）只允许在用户手势
 * 里启动媒体播放，而这个手势令牌**在 await 网络请求之后就失效了**。
 * 点歌 → `await getDashUrl()` 取播放地址 → `audio.play()` 这条链路里，play() 已经不在
 * 手势中，于是被拒（NotAllowedError）
 *
 * 解法：在点击的同步阶段先对媒体元素调一次 `load()`。WebKit 在用户手势中调用 load()
 * 会解除该元素的手势限制，之后再异步换 src / play() 就不再被拦。
 * 只在元素还没有 src 时做：已有源时 load() 会把播放进度清零。
 */
let audioGestureUnlocked = false;

/**
 * 浏览器因缺少用户手势拒绝了播放（NotAllowedError）时置位。
 *
 * 一旦置位，自动换源 / 自动跳下一首全部停手：这些路径最终都要调 `play()`，而在没有
 * 新手势前 `play()` 必然再次被拒，继续重试只会变成「NotAllowed 刷屏 + 请求风暴」
 * （手机端实测日志就是这个现象）。改为停下并提示用户「再点一次」，等真正的手势到来。
 * 下一次 `play()` / `togglePlay()`（都是真实手势）会经 primeAudioForGesture 复位。
 */
let awaitingUserGesture = false;

const primeAudioForGesture = () => {
  // 真实用户手势到达：解除「等待手势」闸门，让后续换源/续播恢复
  awaitingUserGesture = false;
  if (audioGestureUnlocked) return;
  audioGestureUnlocked = true;
  if (audio.src) return;
  try {
    audio.load();
  } catch {
    // 元素还没准备好：忽略，后续 play() 失败会有明确提示
  }
};

const handlePlayError = (error: any) => {
  const errorName = error?.name || "";
  const errorMsg = error?.message || errorName || "";
  // AbortError（"The operation was aborted."）是换源/切歌时 load() 打断了上一次 play()，
  // 属于我们自己造成的正常中断，不是播放失败，弹给用户只会变成噪音刷屏。
  if (errorName === "AbortError" || errorMsg.includes("aborted")) return;
  // NotAllowedError：浏览器（尤其手机）拒绝了非用户手势发起的播放。以前直接吞掉，
  // 结果是「点了没反应也没提示」，必须告诉用户再点一次。
  if (errorName === "NotAllowedError" || errorMsg.includes("NotAllowed")) {
    // 这条会回传到服务端日志：手机上「点了没反应」的根因就靠它定位
    log.warn("浏览器拒绝了本次播放（缺少用户手势）", { errorName, errorMsg, userAgent: navigator.userAgent });
    // 置闸：停掉后续自动换源/自动跳，避免在没有新手势前反复 play() 造成刷屏与请求风暴
    awaitingUserGesture = true;
    if (!audio.paused) audio.pause();
    usePlayList.setState({ isPlaying: false });
    toastError("浏览器阻止了自动播放，请再点一次播放");
    return;
  }
  if (!errorMsg.includes("interrupted")) {
    log.warn("播放出错", { errorName, errorMsg });
    toastError(error instanceof Error ? error.message : "获取播放链接失败");
  }
};

const updateMediaSession = ({ title, artist, cover }: { title: string; artist?: string; cover?: string }) => {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      artwork: cover ? [{ src: cover }] : [],
    });
  }
};

const createAudio = (): HTMLAudioElement => {
  const audio = new Audio();
  audio.preload = "metadata";
  audio.controls = false;
  audio.crossOrigin = "anonymous";
  return audio;
};

export const audio = createAudio();

/** 某个时间点是否已在缓冲区内（MSE 下用来判断跳转会不会踩空） */
const isTimeBuffered = (time: number) => {
  for (let i = 0; i < audio.buffered.length; i += 1) {
    if (time >= audio.buffered.start(i) - 0.1 && time <= audio.buffered.end(i) + 0.1) return true;
  }
  return false;
};

/**
 * 拖动进度条到「还没缓冲到」的位置时，重新挂载音频源的防抖等待（毫秒）。
 * 进度条 Slider 用的是连续触发的 onChange，不合并就会边拖边重挂。
 */
const REMOUNT_SEEK_DEBOUNCE_MS = 250;
let remountSeekTimer: ReturnType<typeof setTimeout> | undefined;
const cancelPendingRemountSeek = () => {
  if (remountSeekTimer) {
    clearTimeout(remountSeekTimer);
    remountSeekTimer = undefined;
  }
};

/**
 * 用户已经跳到、但数据还没到位的目标位置。
 *
 * 重新取流期间元素仍停在旧位置上，`ontimeupdate` 会一路把旧位置写回进度条，
 * 表现就是「松手后进度条弹回原处，加载完才跳过去」。加载期间以这个值为准，
 * 让进度条老老实实停在用户拖到的地方。
 */
let pendingSeekDisplayTime: number | undefined;
/** 保险丝：万一定位始终没落实，也不能让进度条永远僵在那儿 */
let pendingSeekDisplayTimer: ReturnType<typeof setTimeout> | undefined;
const PENDING_SEEK_DISPLAY_MAX_MS = 15000;
const clearPendingSeekDisplay = () => {
  pendingSeekDisplayTime = undefined;
  if (pendingSeekDisplayTimer) {
    clearTimeout(pendingSeekDisplayTimer);
    pendingSeekDisplayTimer = undefined;
  }
};
const holdPendingSeekDisplay = (time: number) => {
  pendingSeekDisplayTime = time;
  if (pendingSeekDisplayTimer) clearTimeout(pendingSeekDisplayTimer);
  pendingSeekDisplayTimer = setTimeout(clearPendingSeekDisplay, PENDING_SEEK_DISPLAY_MAX_MS);
};

/**
 * 当前挂载用的起播位置。用来挡掉「同一个目标被重复挂载」——
 * 进度条 Slider 在按下和抬起各发一次 onChange，间隔常常超过防抖窗，
 * 不挡就会为同一次跳转白白重新取流两遍。
 */
let currentMountStartTime = 0;

/** 已缓冲到的最靠后位置（秒）。用于区分「真卡死」和「还在慢慢下载」 */
const bufferedEnd = () => (audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0);

/**
 * 播放器当前状态快照，回传到服务端日志用于排查移动端卡顿。
 * srcKind：mse=走 MediaSource（blob）、direct=直连 http、none=无源。
 */
const describeAudioState = () => ({
  readyState: audio.readyState, // 0=无信息 … 4=可流畅播放
  networkState: audio.networkState, // 2=NETWORK_LOADING 正在下载
  bufferedEnd: Math.round(bufferedEnd() * 100) / 100,
  currentTime: Math.round(audio.currentTime * 100) / 100,
  duration: Number.isFinite(audio.duration) ? Math.round(audio.duration * 100) / 100 : null,
  paused: audio.paused,
  srcKind: !audio.currentSrc ? "none" : audio.currentSrc.startsWith("blob:") ? "mse" : "direct",
});

const updatePlaybackState = () => {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  }

  if (platform && platform.updatePlaybackState) {
    platform.updatePlaybackState(!audio.paused);
  }
};

const playAudioSafely = async () => {
  if (isOfflineDemo) {
    // The demo has no media endpoint. Keep the real playlist/playbar state machine
    // responsive while avoiding an artificial browser media error from a fixture URL.
    usePlayList.setState({ isPlaying: true });
    return;
  }

  try {
    await audio.play();
  } catch (error) {
    if ((error as DOMException)?.name === "NotSupportedError") {
      // 这条路会静默地重新取址并重新挂载音频源。线上排查「播到一半无声」时，
      // 缺了这行日志就只能看到一次没头没尾的 setAudioSource，无从判断起因。
      log.warn("play() 被拒（NotSupportedError），重新获取播放地址并重挂", describeAudioState());
      const refreshed = await refreshCurrentAudioSource();
      if (refreshed) {
        try {
          await audio.play();
          return;
        } catch (retryError) {
          handlePlayError(retryError);
          return;
        }
      }
      return;
    }
    handlePlayError(error);
  }
};

/** 当前正在进行的 MSE 挂载（iOS）。切歌/换源前必须 abort，避免旧流继续往元素喂数据 */
let activeMediaSourceController: MediaSourceController | undefined;

/**
 * 当前 MSE 挂载累计已下载字节数。首段喂入前 buffered 一直是 0，但只要字节还在到，
 * 就说明源是活的、不是卡死。看门狗用「字节数是否还在涨」作为存活信号，避免误杀正在拉流的源。
 */
let mseDownloadedBytes = 0;

/**
 * 当前音频元素「逻辑上」加载的地址。
 * 走 MSE 时 `audio.src` 是 blob: 对象地址，跟真实媒体地址永远不相等，无法用它判重，
 * 因此单独记一份逻辑地址，供「是否已是当前源」的判断使用。
 */
let currentSourceUrl = "";
const isSameCurrentSource = (url?: string) =>
  isSamePlaybackUrl(currentSourceUrl, url) || isSamePlaybackUrl(audio.src, url);

/** MSE 下 seek 必须等 loadedmetadata：刚挂载时时长未知，提前写 currentTime 会被丢弃 */
const seekOnMetadata = (resumeTime: number) => {
  if (!resumeTime || resumeTime <= 0) return;
  const seek = () => {
    audio.removeEventListener("loadedmetadata", seek);
    try {
      audio.currentTime = resumeTime;
    } catch {
      /* noop */
    }
  };
  audio.addEventListener("loadedmetadata", seek);
};

/**
 * 统一设置音频源。桌面/本地文件走直连（`audio.src = url`）；iOS 的在线流走 MSE 逐段喂，
 * 因为 iOS WebKit 直连播不了 B 站的纯音频分片 MP4（见 media-source.ts）。
 * MSE 失败自动回退直连，让既有的换源/跳过逻辑照常兜底。
 */
const setAudioSource = (
  url: string,
  opts: {
    audioCodecs?: string;
    isDolby?: boolean;
    isLossless?: boolean;
    resumeTime?: number;
    /** 音频码率（bps）。MSE 用它把 resumeTime 换算成字节偏移，实现跳转秒起 */
    audioBandwidth?: number;
    /** 歌曲总时长（秒）。配合响应里的文件总大小换算字节偏移，比码率更准 */
    duration?: number;
  } = {},
) => {
  // 换源/切歌作废掉还没执行的跳转重挂，避免它稍后把刚设好的源又顶掉
  cancelPendingRemountSeek();
  activeMediaSourceController?.abort();
  activeMediaSourceController = undefined;
  mseDownloadedBytes = 0;
  currentSourceUrl = url;
  currentMountStartTime = opts.resumeTime ?? 0;

  if (!url) {
    clearPendingSeekDisplay();
    audio.src = "";
    return;
  }

  // iOS 走 MSE 分段流式播放（bilibili 式）：只喂前几百 KB 就起播，其余边播边下、
  // 并驱逐已播缓冲控内存。原生 <audio> 直连虽然能播，但 iOS 会在起播前缓冲一大段，
  // 造成长前摇、大文件还会超时；分段流式喂能做到近乎秒播（和 bilibili 网页一致）。
  const useMse = shouldUseMediaSource(url);
  log.warn("[src] setAudioSource 决策", {
    useMse,
    isAppleWebKit: useMse,
    resumeTime: opts.resumeTime ?? 0,
    audioBandwidth: opts.audioBandwidth ?? 0,
    isLossless: opts.isLossless,
    isDolby: opts.isDolby,
    audioCodecs: opts.audioCodecs,
  });
  if (useMse) {
    // 注意：**不要**在这里 seekOnMetadata。MSE 只能顺序喂，从外面写 currentTime 会把播放头
    // 推到还没喂到的位置（缓冲区之外），节流/驱逐/配额三套逻辑的前提当场全塌 —— 这正是
    // 「播到一半突然无声」的根因。定位交给喂流器自己：它用 Range 从目标片段取流，
    // 并且只在数据真的覆盖到目标之后才落实 seek（见 media-source.ts 的 applyPendingSeek）。
    const controller = attachMediaSourceAudio(audio, url, {
      audioCodecs: opts.audioCodecs,
      isDolby: opts.isDolby,
      isLossless: opts.isLossless,
      startTime: opts.resumeTime,
      bandwidth: opts.audioBandwidth,
      duration: opts.duration,
      onProgress: received => {
        mseDownloadedBytes = received;
      },
      onError: () => {
        // MSE 失败：回退直连（iOS 上通常也会失败，但会走进既有的 onerror→换源/跳过链路）
        if (activeMediaSourceController?.url !== url) return;
        activeMediaSourceController = undefined;
        seekOnMetadata(opts.resumeTime ?? 0);
        audio.src = url;
        audio.load();
        void playAudioSafely();
      },
    });
    if (controller) {
      activeMediaSourceController = controller;
      return;
    }
    // MIME 不支持等：落到下面直连
  }

  seekOnMetadata(opts.resumeTime ?? 0);
  audio.src = url;
  // 显式 load()：确保换源/续播时元素重新拉取（部分浏览器仅改 src 不重载），
  // 也让 loadedmetadata 稳定触发上面的 seek。
  audio.load();
};

const updatePositionState = () => {
  if ("mediaSession" in navigator) {
    const dur = audio.duration;
    if (!Number.isNaN(dur) && dur !== Infinity) {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: audio.playbackRate,
        position: audio.currentTime,
      });
    }
  }
};

export const isSame = (
  item1?: { type: "mv" | "audio"; sid?: number; bvid?: string; source?: "local" | "online"; id?: string },
  item2?: { type: "mv" | "audio"; sid?: number; bvid?: string; source?: "local" | "online"; id?: string },
) => {
  if (!item1 || !item2) {
    return false;
  }
  if (item1.source === "local" || item2.source === "local") {
    return Boolean(item1.id) && Boolean(item2.id) && item1.id === item2.id;
  }
  if (item1.type !== item2.type) {
    return false;
  }
  if (item1.type === "mv") {
    return Boolean(item1.bvid) && Boolean(item2.bvid) && item1.bvid === item2.bvid;
  }
  if (item1.type === "audio") {
    return item1.sid !== undefined && item2.sid !== undefined && item1.sid === item2.sid;
  }
  return false;
};

const shouldReportPlayRecord = (item?: { type: PlayDataType; source?: "local" | "online" }) =>
  item?.type === "mv" && item?.source !== "local";

/** 一次性打印本设备的媒体能力，用于判断能否走 MSE 绕开元素加载器 */
let mediaCapabilityLogged = false;
const logMediaCapabilityOnce = () => {
  if (mediaCapabilityLogged || typeof window === "undefined") return;
  mediaCapabilityLogged = true;
  const w = window as unknown as { ManagedMediaSource?: unknown; MediaSource?: unknown };
  log.warn("媒体能力探测", {
    buildId: typeof process !== "undefined" ? (process.env.BIU_BUILD_ID ?? "unknown") : "unknown",
    hasManagedMediaSource: typeof w.ManagedMediaSource !== "undefined",
    hasMediaSource: typeof w.MediaSource !== "undefined",
    maxTouchPoints: typeof navigator !== "undefined" ? navigator.maxTouchPoints : undefined,
    ua: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  });
};

/**
 * 用页面 fetch 探测媒体地址的真实响应，回传到服务端日志。
 * 目的：iOS 的 <audio> 走独立媒体加载器，若页面 fetch 能拿到 206+字节而元素却失败，
 * 就能定性为「元素加载器问题」而非网络/代理问题。
 */
async function probeMediaResponse(url: string): Promise<Record<string, unknown>> {
  if (typeof fetch !== "function") return { probe: "no-fetch" };
  try {
    const res = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Range: "bytes=0-65535" },
      method: "GET",
    });
    let bytes = 0;
    try {
      const buf = await res.arrayBuffer();
      bytes = buf.byteLength;
    } catch {
      /* 读取正文失败也无妨，状态码更重要 */
    }
    return {
      probeStatus: res.status,
      probeContentType: res.headers.get("content-type"),
      probeContentRange: res.headers.get("content-range"),
      probeBytes: bytes,
    };
  } catch (error) {
    return { probe: "fetch-threw", probeError: String(error) };
  }
}

export const usePlayList = create<State & Action>()(
  persist(
    immer((set, get) => {
      /**
       * 预判「下一首会是谁」，供播完前预取播放地址用（不改变当前播放）。
       *
       * 随机模式下这里会**当场把随机结果定下来并压进 randomFuture**，
       * 因为 next() 会优先消费前向队列 —— 只有这样才能保证「预取的那首」就是
       * 「真正会播的那首」，否则预取全白做。
       */
      const peekNextPlayId = (): string | undefined => {
        const { playMode, list, playId, nextId, shouldKeepPagesOrderInRandomPlayMode } = get();
        if (!list?.length || !playId) return undefined;
        // 单曲循环不切歌；addToNext 指定了下一首就直接用它
        if (playMode === PlayMode.Single) return undefined;
        if (nextId) return nextId;

        const currentIndex = list.findIndex(item => item.id === playId);
        if (currentIndex < 0 || list.length === 1) return undefined;
        if (playMode !== PlayMode.Random) return list[(currentIndex + 1) % list.length].id;

        const currentPlayItem = list[currentIndex];
        if (
          shouldKeepPagesOrderInRandomPlayMode &&
          currentPlayItem.pageIndex &&
          currentPlayItem.pageIndex !== currentPlayItem.totalPage
        ) {
          const nextPage = list.find(
            item => item.bvid === currentPlayItem.bvid && item.pageIndex === currentPlayItem.pageIndex! + 1,
          );
          if (nextPage) return nextPage.id;
        }

        // 前向队列里已有有效目标：next() 会消费它
        const queued = get().randomFuture.find(id => list.some(item => item.id === id));
        if (queued) return queued;

        const playedThisCycle = new Set(get().randomPlayedIds);
        playedThisCycle.add(playId);
        let candidates = list.filter(item => !playedThisCycle.has(item.id));
        const startNewCycle = candidates.length === 0;
        if (startNewCycle) candidates = list.filter(item => item.id !== playId);
        if (!candidates.length) return undefined;

        const picked = candidates[Math.floor(Math.random() * candidates.length)].id;
        set(state => {
          // 与 next() 的随机选曲保持同一套「播完全部前不重复」账本
          if (startNewCycle) {
            state.randomPlayedIds = [picked];
          } else {
            pushUnique(state.randomPlayedIds, playId);
            pushUnique(state.randomPlayedIds, picked);
          }
          state.randomFuture.unshift(picked);
        });
        return picked;
      };

      const ensureAudioSrcValid = async () => {
        const { playId, list } = get();
        const currentPlayItem = list.find(item => item.id === playId);
        if (isOfflineDemo) {
          // The demo represents playback state without mounting a media URL. This
          // keeps the real playlist controls usable while guaranteeing that no
          // browser media loader or source-refresh path can issue a request.
          return;
        }
        if (currentPlayItem?.source === "local" && currentPlayItem?.audioUrl) {
          const currentTime = usePlayProgress.getState().currentTime;
          if (!isSameCurrentSource(currentPlayItem.audioUrl)) {
            // 本地文件是 blob/文件地址，setAudioSource 内部会判定为直连
            setAudioSource(currentPlayItem.audioUrl, {
              duration: currentPlayItem.duration,
              resumeTime: currentTime > 0 ? currentTime : undefined,
            });
          } else if (typeof currentTime === "number" && currentTime > 0) {
            seekAudioTo(currentTime);
          }
          return;
        }
        if (isUrlValid(currentPlayItem?.audioUrl)) {
          const currentTime = usePlayProgress.getState().currentTime;
          if (!isSameCurrentSource(currentPlayItem?.audioUrl)) {
            setAudioSource(currentPlayItem!.audioUrl!, {
              audioCodecs: currentPlayItem?.audioCodecs,
              audioBandwidth: currentPlayItem?.audioBandwidth,
              duration: currentPlayItem?.duration,
              isDolby: currentPlayItem?.isDolby,
              isLossless: currentPlayItem?.isLossless,
              resumeTime: currentTime > 0 ? currentTime : undefined,
            });
          } else if (typeof currentTime === "number" && currentTime > 0) {
            seekAudioTo(currentTime);
          }
          return;
        }

        if (currentPlayItem?.type === "mv" && currentPlayItem?.bvid && currentPlayItem?.cid) {
          const mvPlayData = await getDashUrl(currentPlayItem.bvid, currentPlayItem.cid);
          if (get().playId !== playId) return;
          if (mvPlayData?.audioUrl) {
            if (!isSameCurrentSource(mvPlayData.audioUrl)) {
              const currentTime = usePlayProgress.getState().currentTime;
              setAudioSource(mvPlayData.audioUrl, {
                audioCodecs: mvPlayData.audioCodecs,
                audioBandwidth: mvPlayData.audioBandwidth,
                duration: currentPlayItem?.duration,
                isDolby: mvPlayData.isDolby,
                isLossless: mvPlayData.isLossless,
                resumeTime: currentTime > 0 ? currentTime : undefined,
              });
            }
            set(state => {
              const listItem = state.list.find(item => item.id === playId);
              if (listItem) {
                listItem.audioUrl = mvPlayData.audioUrl;
                listItem.audioUrlCandidates = mvPlayData.audioUrlCandidates;
                listItem.videoUrl = mvPlayData.videoUrl;
                listItem.isLossless = mvPlayData.isLossless;
                listItem.audioCodecs = mvPlayData.audioCodecs;
                listItem.audioBandwidth = mvPlayData.audioBandwidth;
                listItem.isDolby = mvPlayData.isDolby;
              }
            });
          } else {
            log.error("无法获取音频播放链接", {
              type: "mv",
              bvid: currentPlayItem.bvid,
              cid: currentPlayItem.cid,
              title: currentPlayItem.title,
              mvPlayData,
            });
            if (!(await dropCurrentIfInvalid(currentPlayItem.id, currentPlayItem))) {
              toastError("无法获取音频播放链接");
            }
          }
        }

        if (currentPlayItem?.type === "audio" && currentPlayItem?.sid) {
          const musicPlayData = await getAudioUrl(currentPlayItem.sid);
          if (get().playId !== playId) return;
          if (musicPlayData?.audioUrl) {
            if (!isSameCurrentSource(musicPlayData.audioUrl)) {
              const currentTime = usePlayProgress.getState().currentTime;
              setAudioSource(musicPlayData.audioUrl, {
                audioCodecs: musicPlayData.audioCodecs,
                duration: currentPlayItem?.duration,
                isLossless: musicPlayData.isLossless,
                resumeTime: currentTime > 0 ? currentTime : undefined,
              });
            }
            set(state => {
              const listItem = state.list.find(item => item.id === playId);
              if (listItem) {
                listItem.audioUrl = musicPlayData.audioUrl;
                listItem.audioUrlCandidates = musicPlayData.audioUrlCandidates;
                listItem.isLossless = musicPlayData.isLossless;
                listItem.audioCodecs = musicPlayData.audioCodecs;
              }
            });
          } else {
            log.error("无法获取音频播放链接", {
              type: "audio",
              sid: currentPlayItem.sid,
              title: currentPlayItem.title,
              musicPlayData,
            });
            if (!(await dropCurrentIfInvalid(currentPlayItem.id, currentPlayItem))) {
              toastError("无法获取音频播放链接");
            }
          }
        }
      };

      return {
        isPlaying: false,
        isMuted: false,
        volume: 0.5,
        playMode: PlayMode.Loop,
        rate: 1,
        duration: undefined,
        shouldKeepPagesOrderInRandomPlayMode: true,
        randomHistory: [],
        randomFuture: [],
        randomPlayedIds: [],
        list: [],
        init: async () => {
          logMediaCapabilityOnce();
          if (audio) {
            audio.volume = get().volume;
            audio.muted = get().isMuted;
            audio.playbackRate = get().rate;
            audio.loop = get().playMode === PlayMode.Single;

            // 连续播放失败计数：自动跳过坏曲时，避免整个列表都失效时无限循环 next()
            let consecutiveErrorCount = 0;

            // 卡死看门狗：进入缓冲后超时仍无任何进度（坏源常见表现是不报错只挂起），
            // 视为播放失败触发换源自救；期间有进度推进则视为网络慢，重新计时观察。
            // 12s（不是 8s）：移动端经隧道+无线网，初始缓冲比桌面慢得多，8s 太容易误杀。
            const STALL_TIMEOUT_MS = 12000;
            const NETWORK_LOADING = 2; // HTMLMediaElement.NETWORK_LOADING
            // 弱网初始缓冲宽限：只要「源探测正常 + 元素仍在加载」，就一轮轮延长等待，
            // 最多再宽限 6 轮 ≈ 72s。手机隧道网络下慢，12s 一刀切容易误杀正常但慢的源；
            // 期间源一直正常就不误杀，真正的坏源探测会失败、照常换源/跳过。
            const MAX_STALL_GRACE = 6;
            let stallGraceUsed = 0;
            let stallWatchdog: ReturnType<typeof setTimeout> | undefined;
            const clearStallWatchdog = () => {
              if (stallWatchdog) {
                clearTimeout(stallWatchdog);
                stallWatchdog = undefined;
              }
            };
            const armStallWatchdog = () => {
              if (stallWatchdog) return;
              const playId = get().playId;
              if (!playId) return;
              const positionAtArm = audio.currentTime;
              const bufferedAtArm = bufferedEnd();
              const mseBytesAtArm = mseDownloadedBytes;
              stallWatchdog = setTimeout(() => {
                stallWatchdog = undefined;
                if (get().playId !== playId || audio.paused) return;
                // 关键修复：不只看播放位置，也看缓冲是否在增长。
                // 移动端初始缓冲期 currentTime 长时间停在 0，但 buffered 一直在涨——
                // 这是「慢」不是「卡死」，只看 currentTime 会误判并触发无谓换源，
                // 换源又重置缓冲，反复三次后错误跳过整首歌（桌面缓冲快所以从不触发）。
                const advancedPlayback = audio.currentTime !== positionAtArm;
                const advancedBuffer = bufferedEnd() > bufferedAtArm + 0.1;
                // iOS MSE 起播前（首段还没喂入）buffered 恒为 0，但只要下载字节还在涨，
                // 就是「下载慢」不是「卡死」，同样重新计时，避免误杀正在拉流的源。
                const advancedDownload = mseDownloadedBytes > mseBytesAtArm;
                if (advancedPlayback || advancedBuffer || advancedDownload) {
                  stallGraceUsed = 0; // 有真实进度，宽限额度归零
                  armStallWatchdog();
                  return;
                }
                // 无可见进度：先探一次真实 HTTP 状态。iOS 原生加载器在缓冲大文件时
                // currentTime/buffered 会长时间都是 0，但只要页面 fetch 拿得到字节、
                // 且元素还在 LOADING，就是「还没缓冲够」而不是「卡死」——延长等待，别误杀。
                const stalledSrc = audio.src;
                void probeMediaResponse(stalledSrc)
                  .then(probe => {
                    if (get().playId !== playId || audio.paused) return;
                    const stillLoading = audio.networkState === NETWORK_LOADING && !audio.error;
                    const sourceHealthy = probe.probeStatus === 200 || probe.probeStatus === 206;
                    if (stillLoading && sourceHealthy && stallGraceUsed < MAX_STALL_GRACE) {
                      stallGraceUsed += 1;
                      log.warn("播放暂无进度但源正常且仍在加载，延长等待", {
                        playId,
                        grace: stallGraceUsed,
                        ...describeAudioState(),
                        ...probe,
                      });
                      armStallWatchdog();
                      return;
                    }
                    log.warn("播放长时间无进度，触发换源自救", { playId, ...describeAudioState(), ...probe });
                    void handlePlaybackFailure(playId, stalledSrc, { message: "stall watchdog timeout" });
                  })
                  .catch(() => {
                    void handlePlaybackFailure(playId, stalledSrc, { message: "stall watchdog timeout" });
                  });
              }, STALL_TIMEOUT_MS);
            };

            // 同一首歌的失败处理正在进行时忽略新的失败事件：换源期间 onerror 与看门狗
            // 可能同时开火，重入会让请求量翻倍
            let failureHandlingId: string | undefined;

            // 播放失败统一处理（onerror 与卡死看门狗共用）：先换源自救，救不回来才跳下一首
            const handlePlaybackFailure = async (
              playId: string,
              failedSrc: string,
              errInfo: { code?: number; message?: string },
            ) => {
              if (failureHandlingId === playId) return;
              failureHandlingId = playId;
              try {
                await runPlaybackFailure(playId, failedSrc, errInfo);
              } finally {
                if (failureHandlingId === playId) failureHandlingId = undefined;
              }
            };

            const runPlaybackFailure = async (
              playId: string,
              failedSrc: string,
              errInfo: { code?: number; message?: string },
            ) => {
              clearStallWatchdog();
              // 浏览器在等新手势（NotAllowed）：任何自动 play() 都注定被拒，停手等用户再点一次，
              // 否则就是 NotAllowed 刷屏 + 请求风暴
              if (awaitingUserGesture) return;
              // 对齐官方播放器的容错：先换备用地址/重新取地址自救
              if (await tryFailoverAudioSource(playId, failedSrc)) return;
              // 自救期间用户已切歌：不再处理
              if (get().playId !== playId) return;

              // 换源都救不回来：若确认稿件已被删除/下架，直接从列表移除并续播（自然跳过失效歌曲）
              const failedItem = get().list.find(item => item.id === playId);
              if (failedItem && (await dropCurrentIfInvalid(playId, failedItem))) {
                consecutiveErrorCount = 0;
                return;
              }

              consecutiveErrorCount += 1;
              const listLength = get().list.length;
              // 防 runaway：连续几首都失败通常意味着断网 / 整体不可用，继续往下跳只会
              // 把整张歌单的取址接口全打一遍（原来的阈值是列表长度，几百首时形同虚设）
              const skipLimit = Math.min(listLength, MAX_CONSECUTIVE_SKIPS);
              if (listLength === 0 || consecutiveErrorCount >= skipLimit) {
                consecutiveErrorCount = 0;
                if (!audio.paused) audio.pause();
                set({ isPlaying: false });
                toastError("当前歌曲无法播放，请检查网络后重试");
                return;
              }

              log.error("音频播放失败，自动跳到下一首", {
                playId,
                src: failedSrc,
                ...errInfo,
                ...describeAudioState(),
              });
              toastError("当前歌曲无法播放，已自动跳过");
              // 退避后再跳：避免一秒内连锁跳过多首、瞬间打出大量请求
              await delay(AUTO_SKIP_DELAY_MS);
              if (get().playId !== playId) return;
              void get().next();
            };

            audio.ondurationchange = () => {
              const dur = audio.duration;
              if (!Number.isNaN(dur) && dur !== Infinity) {
                const staticDuration = get().getPlayItem?.()?.duration;
                const normalizedDuration = Math.round(dur * 100) / 100;
                set({
                  // B 站接口的时长是列表展示的权威值，避免音频流的 273.x 秒被格式化成 04:33。
                  duration:
                    typeof staticDuration === "number" && Number.isFinite(staticDuration) && staticDuration > 0
                      ? staticDuration
                      : normalizedDuration,
                });
                updatePositionState();
              }
            };

            audio.ontimeupdate = () => {
              const currentTime = Math.round(audio.currentTime * 100) / 100;
              // 跳转还在重新取流：进度条停在用户跳到的位置，别被旧位置的 timeupdate 拉回去
              if (pendingSeekDisplayTime === undefined) {
                usePlayProgress.getState().setCurrentTime(currentTime);
              }
              const playItem = get().getPlayItem?.();
              if (shouldReportPlayRecord(playItem)) {
                void reportHeartbeat(playItem, currentTime, audio.duration, 0);
              }
              maybePrefetchNextSource(currentTime, peekNextPlayId);
            };

            audio.onseeked = () => {
              // 定位真正落实（含 MSE 数据到位后补的那一下）：交还进度条控制权
              clearPendingSeekDisplay();
              usePlayProgress.getState().setCurrentTime(Math.round(audio.currentTime * 100) / 100);
              updatePositionState();
            };

            // 缓冲事件驱动卡死看门狗：长时间无进度时换源自救
            audio.onwaiting = armStallWatchdog;
            audio.onstalled = armStallWatchdog;
            audio.onplaying = () => clearStallWatchdog();

            audio.onratechange = () => {
              updatePositionState();
            };

            audio.onplay = () => {
              // 播放是用户手势：借机恢复可能被浏览器自动挂起的音频图，确保音量增强生效
              resumeAudioGraph();
              consecutiveErrorCount = 0; // 成功开始播放，重置失败计数
              set({ isPlaying: true });
              updatePlaybackState();
              updatePositionState();
              const playItem = get().getPlayItem?.();
              if (shouldReportPlayRecord(playItem)) {
                void reportHeartbeat(playItem, audio.currentTime, audio.duration, 1);
              }
            };

            audio.onpause = () => {
              clearStallWatchdog();
              set({ isPlaying: false });
              updatePlaybackState();
              updatePositionState();
              const playItem = get().getPlayItem?.();
              if (shouldReportPlayRecord(playItem)) {
                void reportHeartbeat(playItem, audio.currentTime, audio.duration, 2);
              }
            };

            audio.onended = () => {
              if (get().playMode === PlayMode.Single) {
                return;
              }

              const playItem = get().getPlayItem?.();
              if (shouldReportPlayRecord(playItem)) {
                void reportHeartbeat(playItem, audio.duration, audio.duration, 4);
                endPlayReport();
              }

              get().next();
            };

            // 加载/解码失败时自动跳到下一首。
            //
            // 触发场景：UP 主下架视频、签名 URL 过期（长时间暂停后）、网络中断、
            // 视频被替换 cid。原本只有 `audio.onended` 会调 next()，加载阶段就失败
            // 时不会触发 ended，导致 UI 卡住不动；这里补齐失败路径。
            audio.onerror = () => {
              // src 被清空（clear() 会触发）/ 已无当前播放项：忽略
              if (!audio.getAttribute("src")) return;
              const playId = get().playId;
              if (!playId) return;
              const err = audio.error;
              // ABORTED(1) 是用户主动中止（切歌时旧请求被打断），不算播放失败
              if (!err || err.code === MediaError.MEDIA_ERR_ABORTED) return;

              const erroredSrc = audio.src;
              void probeMediaResponse(erroredSrc).then(probe => {
                log.warn("音频元素报错", {
                  playId,
                  code: err.code,
                  message: err.message,
                  ...describeAudioState(),
                  ...probe,
                });
              });
              void handlePlaybackFailure(playId, erroredSrc, { code: err.code, message: err.message });
            };

            if ("mediaSession" in navigator) {
              navigator.mediaSession.setActionHandler("play", () => get().togglePlay());
              navigator.mediaSession.setActionHandler("pause", () => get().togglePlay());
              navigator.mediaSession.setActionHandler("previoustrack", () => get().prev());
              navigator.mediaSession.setActionHandler("nexttrack", () => {
                if (get().list.length > 1) {
                  get().next();
                }
              });
              navigator.mediaSession.setActionHandler("seekto", details => {
                if (details.seekTime) get().seek(Math.round(details.seekTime * 100) / 100);
                updatePositionState();
              });
              navigator.mediaSession.setActionHandler("seekbackward", details => {
                const offset = details?.seekOffset || 10;
                get().seek(Math.round((audio.currentTime - offset) * 100) / 100);
              });
              navigator.mediaSession.setActionHandler("seekforward", details => {
                const offset = details?.seekOffset || 10;
                get().seek(Math.round((audio.currentTime + offset) * 100) / 100);
              });
            }

            if (get().playId) {
              const playItem = get().list.find(item => item.id === get().playId);
              if (playItem) {
                // 顺序很重要：进度必须**先**从 localStorage 恢复到 store，再挂载音频源。
                // 否则 ensureAudioSrcValid 读到的 currentTime 还是初始值 0，会当成「从头播」
                // 挂上 MSE，紧接着的定位又把播放头推到几十秒外 —— 播放头落在缓冲区之外，
                // 无声且救不回来（见 seekAudioTo 的注释）。这条路每次带进度刷新都会走到。
                const localCurrentTime = usePlayProgress.getState().initCurrentTime();
                await ensureAudioSrcValid();
                if (localCurrentTime) {
                  seekAudioTo(localCurrentTime);
                }

                // 刷新/冷启动只「恢复」上次的歌与进度，绝不自动开播：底部状态栏照常显示、
                // 进度保留，但保持暂停，等用户主动点播放。（否则一刷新就自动出声，很突兀。）
                if (!audio.paused) audio.pause();
                set({ isPlaying: false });

                updateMediaSession({
                  title: playItem.title,
                  artist: playItem.ownerName,
                  cover: playItem.pageCover,
                });
              }
            }
          }
        },
        toggleMute: () => {
          if (audio) {
            audio.muted = !audio.muted;
          }
          set(s => ({ isMuted: !s.isMuted }));
        },
        setVolume: volume => {
          if (audio) {
            audio.volume = volume;
          }
          set(state => {
            state.volume = volume;
          });
        },
        togglePlayMode: () => {
          const playModeList = getPlayModeList();
          const currentIndex = playModeList.findIndex(item => item.value === get().playMode);
          const nextIndex = (currentIndex + 1) % playModeList.length;
          const nextPlayMode = playModeList[nextIndex].value;

          if (audio) {
            audio.loop = nextPlayMode === PlayMode.Single;
          }
          set(state => {
            state.playMode = nextPlayMode;
            // 切入随机模式：开启新一轮，把当前歌标记为已播，避免紧挨重复
            if (nextPlayMode === PlayMode.Random) {
              state.randomPlayedIds = state.playId ? [state.playId] : [];
            }
          });
        },
        setRate: rate => {
          if (audio) {
            audio.playbackRate = rate;
          }
          set(state => {
            state.rate = rate;
          });
        },
        seek: s => {
          usePlayProgress.getState().setCurrentTime(s);
          seekAudioTo(s);
        },
        togglePlay: async () => {
          primeAudioForGesture();
          if (!get().list?.length) {
            return;
          }

          if (!get().playId) {
            return;
          }

          if (isOfflineDemo) {
            set(state => {
              state.isPlaying = !state.isPlaying;
            });
            return;
          }

          if (audio.paused) {
            set(state => {
              state.isPlaying = true;
            });
            await ensureAudioSrcValid();
            await playAudioSafely();
          } else {
            audio.pause();
            set(state => {
              state.isPlaying = false;
            });
          }
        },
        setShouldKeepPagesOrderInRandomPlayMode: shouldKeep => {
          set({ shouldKeepPagesOrderInRandomPlayMode: shouldKeep });
        },
        play: async ({
          type,
          bvid,
          sid,
          title,
          cover,
          ownerName,
          ownerMid,
          id,
          source,
          audioUrl,
          playCount,
          duration,
          cid: targetCid,
        }: PlayItem) => {
          // 必须在任何 await 之前：手机浏览器的播放许可只在同步的手势阶段有效
          primeAudioForGesture();
          const { list, playId } = get();
          const currentItem = list?.find(item => item.id === playId);
          const sanitizedTitle = sanitizeTitle(title);
          const candidate = { type, bvid, sid, source, id };

          // 当前正在播放，如果暂停了则播放（指定了分集时校验 cid）
          if (isSame(currentItem, candidate) && (!targetCid || currentItem?.cid === targetCid)) {
            // 分集显示标题/封面跟随调用方传入的值（如收藏夹里重命名后再次点击）
            if (targetCid && currentItem) {
              set(state => {
                const target = state.list.find(item => item.id === currentItem.id);
                if (!target) return;
                if (sanitizedTitle) {
                  target.pageTitle = sanitizedTitle;
                }
                if (cover) {
                  target.pageCover = formatUrlProtocol(cover);
                }
                if (duration && !target.duration) {
                  target.duration = duration;
                }
              });
            }
            if (audio.paused) {
              await ensureAudioSrcValid();
              await playAudioSafely();
            }
            return;
          }

          // 列表已存在（指定分集时精确匹配 cid，否则按 bvid/sid 匹配）
          const existItem = targetCid
            ? list?.find(item => item.cid === targetCid)
            : list?.find(item => isSame(item, candidate));
          if (existItem) {
            if (targetCid) {
              // 指定分集时，清除同视频其他分集，避免播完后续播不属于本次收藏的集数
              set(state => {
                state.list = state.list.filter(item => !(item.bvid === bvid && item.cid !== targetCid));
                // 显示标题/封面同步为调用方传入的值（收藏时调整的名字与收藏夹封面）
                const target = state.list.find(item => item.id === existItem.id);
                if (target) {
                  if (sanitizedTitle) {
                    target.pageTitle = sanitizedTitle;
                  }
                  if (cover) {
                    target.pageCover = formatUrlProtocol(cover);
                  }
                  if (duration && !target.duration) {
                    target.duration = duration;
                  }
                }
                state.playId = existItem.id;
              });
              try {
                await ensureAudioSrcValid();
                await playAudioSafely();
              } catch (error) {
                handlePlayError(error);
              }
              return;
            } else {
              // 整集播放：若多P视频的分集未全部在队列中，重新获取全集（避免只有部分分集无法续播）
              const pagesInQueue = bvid ? list.filter(item => item.bvid === bvid).length : 1;
              const allPagesLoaded = !existItem.hasMultiPart || pagesInQueue >= (existItem.totalPage ?? 1);
              if (allPagesLoaded) {
                set(state => {
                  // 同一视频可能已因别的入口（如收藏夹重命名）带着旧标题/封面在队列里，
                  // 这里跟随本次点击来源刷新，避免播放栏与当前点击的列表显示不一致
                  const target = state.list.find(item => item.id === existItem.id);
                  if (target) {
                    if (sanitizedTitle) {
                      target.pageTitle = sanitizedTitle;
                    }
                    if (cover) {
                      target.pageCover = formatUrlProtocol(cover);
                    }
                    if (duration && !target.duration) {
                      target.duration = duration;
                    }
                  }
                  state.playId = existItem.id;
                });
                try {
                  await ensureAudioSrcValid();
                  await playAudioSafely();
                } catch (error) {
                  handlePlayError(error);
                }
                return;
              }
              // 分集不完整，跌落到下方重新获取全集数据
            }
          }

          const isLocal = source === "local";
          // 新添加项
          let playItem: PlayData[] =
            isLocal && id
              ? [
                  {
                    id,
                    type,
                    source,
                    audioUrl,
                    title: sanitizedTitle,
                    duration,
                  },
                ]
              : [
                  {
                    id: idGenerator(),
                    type,
                    bvid,
                    sid,
                    title: sanitizedTitle,
                    cover: cover ? formatUrlProtocol(cover) : undefined,
                    ownerName,
                    ownerMid,
                    playCount,
                    duration,
                  },
                ];
          // 补充缺失信息（有 targetCid 时也需要获取完整分集列表）
          if (!isLocal && (!cover || !ownerName || !ownerMid || targetCid)) {
            if (type === "mv" && bvid) {
              playItem = await getMVData(bvid);
            }

            if (type === "audio" && sid) {
              playItem = await getAudioData(sid);
            }
          }

          // 指定了分集时定位到目标分集，否则从第一项开始
          const nextPlayItem = (targetCid ? playItem.find(p => p.cid === targetCid) : undefined) ?? playItem[0];
          if (!nextPlayItem) {
            toastError("播放失败：无法获取播放信息");
            return;
          }

          // 指定分集播放（来自本地收藏夹）时，调用方传入的标题（收藏时调整的
          // 「原歌名-P1」或重命名后的名字）与封面优先于 B 站分 P 名/首帧截图，
          // 保证播放栏与收藏夹列表显示一致
          if (targetCid) {
            if (sanitizedTitle) {
              nextPlayItem.pageTitle = sanitizedTitle;
            }
            if (cover) {
              nextPlayItem.pageCover = formatUrlProtocol(cover);
            }
          }

          set(state => {
            // 指定了分集时只加入目标分集，避免其余分集自动续播
            const itemsToAdd = targetCid ? [nextPlayItem] : playItem;
            // 整集播放时，若队列中已有该视频的部分分集（如之前按分集收藏），先清理再重新入队全集
            if (!targetCid && bvid) {
              state.list = state.list.filter(item => item.bvid !== bvid);
            }
            // 插到当前播放歌曲的下一位而不是队尾：插入的歌播完后顺着原歌单继续，
            // 列表循环时不会每次点歌后都从歌单头重播；无当前歌时退化为追加到队尾
            const currentIndex = state.list.findIndex(item => item.id === state.playId);
            const insertAt = currentIndex === -1 ? state.list.length : currentIndex + 1;
            state.list.splice(insertAt, 0, ...itemsToAdd);
            state.playId = nextPlayItem.id;
            if (isOfflineDemo) state.isPlaying = true;
          });
        },
        playListItem: async (id: string) => {
          if (get().playId === id) {
            return;
          }

          const { playMode, playId } = get();
          set(state => {
            // 随机模式下直接点歌视为主动导航：当前歌压入历史，清空前向队列
            if (playMode === PlayMode.Random) {
              if (playId) {
                state.randomHistory.push(playId);
                pushUnique(state.randomPlayedIds, playId);
              }
              state.randomFuture = [];
              // 点选的歌计入本轮已播，避免随机时再次抽到
              pushUnique(state.randomPlayedIds, id);
            }
            state.playId = id;
            if (isOfflineDemo) state.isPlaying = true;
            if (state.nextId === id) {
              state.nextId = undefined;
            }
          });
        },
        playList: async items => {
          const { playId: oldPlayId, list: oldList, playMode, randomHistory: oldHistory } = get();
          const oldPlayItem = oldList.find(item => item.id === oldPlayId);

          const newList = items.map(item => ({
            ...item,
            title: sanitizeTitle(item.title),
            id: item.source === "local" && item.id ? item.id : idGenerator(),
          }));

          const initialId =
            playMode === PlayMode.Random && newList.length > 1
              ? newList[Math.floor(Math.random() * newList.length)].id
              : newList[0].id;

          // 随机模式：重建历史栈。
          //
          // 陷阱 1：新 list 的 id 全部由 idGenerator() 重新生成，旧 id 在新 list 里找不到，
          //   必须用内容匹配（mv→bvid，audio→sid，local→id）。
          // 陷阱 2：playList 收到的 PlayItem[] 里 mv.cid 尚未 resolve（值为 undefined），
          //   所以 mv 只能按 bvid 匹配，不能加 cid。
          // 做法：把旧 randomHistory（上上首、更早…）+ 旧当前歌（上一首）依次映射到新 id，
          //   保持原有顺序，跳过在新 list 里找不到的条目，去重后压入新历史。
          const newHistory: string[] = [];
          if (playMode === PlayMode.Random) {
            const findNewId = (oldItem: PlayData): string | undefined => {
              return newList.find(n => {
                if (oldItem.source === "local") return n.id === oldItem.id;
                if (oldItem.type === "mv") return n.bvid !== undefined && n.bvid === oldItem.bvid;
                if (oldItem.type === "audio") return n.sid !== undefined && n.sid === oldItem.sid;
                return false;
              })?.id;
            };

            // 旧历史（从最早到最近）+ 旧当前歌追加到末尾
            const oldHistoryItems = oldHistory
              .map(id => oldList.find(item => item.id === id))
              .filter((item): item is PlayData => item !== undefined);
            const candidates = oldPlayItem ? [...oldHistoryItems, oldPlayItem] : oldHistoryItems;

            const seen = new Set<string>([initialId]); // 排除本次随机选中的歌
            for (const oldItem of candidates) {
              const newId = findNewId(oldItem);
              if (newId && !seen.has(newId)) {
                seen.add(newId);
                newHistory.push(newId);
              }
            }
          }

          set(state => {
            state.randomHistory = newHistory;
            state.randomFuture = [];
            // 新队列开启新一轮随机：当前歌标记为已播
            state.randomPlayedIds = playMode === PlayMode.Random ? [initialId] : [];
            state.list = newList;
            state.playId = initialId;
            if (isOfflineDemo) state.isPlaying = true;
            // 地址解析是异步的，不能让进度条在这段时间继续显示上一首的时长。
            state.duration = newList.find(item => item.id === initialId)?.duration;
          });
        },
        next: async () => {
          const { playMode, list, playId, nextId, shouldKeepPagesOrderInRandomPlayMode } = get();

          if (!list?.length) {
            return;
          }

          if (!playId) {
            return;
          }

          // 指定了下一首（addToNext）：直接跳过去，视为主动导航（清空前向队列）
          if (nextId) {
            set(state => {
              if (playMode === PlayMode.Random) {
                state.randomHistory.push(playId);
                state.randomFuture = [];
                pushUnique(state.randomPlayedIds, playId);
                pushUnique(state.randomPlayedIds, nextId);
              }
              state.playId = nextId;
              state.nextId = undefined;
            });
            return;
          }

          const currentIndex = list.findIndex(item => item.id === playId);
          const nextIndex = (currentIndex + 1) % list.length;
          switch (playMode) {
            case PlayMode.Single:
            case PlayMode.Loop: {
              if (list.length === 1) {
                // 单首列表循环 = 从头重播，直接重挂从 0 起播。
                // 不走 seekAudioTo：那是「跳转」入口，会被拖动防抖推迟 250ms，
                // 还会先在已结束的旧源上 play() 一次再重挂，绕了一圈。
                if (currentSourceUrl) {
                  resetAudioAndPlay(currentSourceUrl);
                } else {
                  seekAudioTo(0);
                  await playAudioSafely();
                }
                break;
              }

              set(state => {
                state.playId = list[nextIndex].id;
              });
              break;
            }
            case PlayMode.Random: {
              const currentPlayItem = list[currentIndex];

              if (list.length === 1) {
                // 单首列表循环 = 从头重播，直接重挂从 0 起播。
                // 不走 seekAudioTo：那是「跳转」入口，会被拖动防抖推迟 250ms，
                // 还会先在已结束的旧源上 play() 一次再重挂，绕了一圈。
                if (currentSourceUrl) {
                  resetAudioAndPlay(currentSourceUrl);
                } else {
                  seekAudioTo(0);
                  await playAudioSafely();
                }
                break;
              }

              // 保持分集顺序：当前为分集视频且不是最后一集，顺序播下一集（不影响前向队列）
              if (
                shouldKeepPagesOrderInRandomPlayMode &&
                currentPlayItem.pageIndex &&
                currentPlayItem.pageIndex !== currentPlayItem.totalPage
              ) {
                const nextPage = list.find(
                  item => item.bvid === currentPlayItem.bvid && item.pageIndex === currentPlayItem.pageIndex! + 1,
                );
                if (nextPage) {
                  set(state => {
                    state.randomHistory.push(playId);
                    pushUnique(state.randomPlayedIds, playId);
                    pushUnique(state.randomPlayedIds, nextPage.id);
                    state.playId = nextPage.id;
                  });
                  break;
                }
              }

              // 前向队列非空：复用已探索的路径（上一首→再下一首回到同一首，保证幂等）
              const { randomFuture } = get();
              if (randomFuture.length > 0) {
                // 跳过已被删除的条目，直到找到有效的
                let futureId: string | undefined;
                set(state => {
                  while (state.randomFuture.length > 0) {
                    const candidate = state.randomFuture.shift()!;
                    if (state.list.some(item => item.id === candidate)) {
                      futureId = candidate;
                      break;
                    }
                  }
                  if (futureId) {
                    state.randomHistory.push(playId);
                    pushUnique(state.randomPlayedIds, playId);
                    pushUnique(state.randomPlayedIds, futureId);
                    state.playId = futureId;
                  }
                });
                if (futureId) break;
                // 队列全部失效，跌落到随机生成
              }

              // 懒惰生成新随机歌：本轮已播过的（randomPlayedIds）不再抽取，
              // 直到全部歌曲都播过一遍才清空开启新一轮，实现「播完全部前不重复」。
              const playedThisCycle = new Set(get().randomPlayedIds);
              playedThisCycle.add(playId); // 当前歌算作已播
              let candidates = list.filter(item => !playedThisCycle.has(item.id));
              const startNewCycle = candidates.length === 0;
              if (startNewCycle) {
                // 本轮已播完所有歌：开启新一轮，仅排除当前歌避免紧挨重复
                candidates = list.filter(item => item.id !== playId);
              }
              const randomIndex = Math.floor(Math.random() * candidates.length);
              const nextRandomId = candidates[randomIndex].id;
              set(state => {
                state.randomHistory.push(playId);
                if (startNewCycle) {
                  // 新一轮是「全部歌曲」的又一次完整覆盖：仅以新选中歌为起点
                  // （上一首已从候选里排除，保证不紧挨重复），上一首仍会在本轮内被播到。
                  state.randomPlayedIds = [nextRandomId];
                } else {
                  pushUnique(state.randomPlayedIds, playId);
                  pushUnique(state.randomPlayedIds, nextRandomId);
                }
                state.playId = nextRandomId;
              });
              break;
            }
          }
        },
        prev: async () => {
          const { playId, list, playMode, randomHistory } = get();

          if (!list?.length) {
            return;
          }

          if (!playId) {
            return;
          }

          // 随机模式：游标左移——当前歌推入前向队列，从历史栈弹出上一首
          if (playMode === PlayMode.Random && randomHistory.length > 0) {
            set(state => {
              while (state.randomHistory.length > 0) {
                const candidate = state.randomHistory.pop()!;
                if (state.list.some(item => item.id === candidate)) {
                  state.randomFuture.unshift(playId); // 当前歌压入前向队列头部
                  state.playId = candidate;
                  return;
                }
              }
            });
            // 若历史栈非空但全部条目都已失效，继续跌落顺序回退
            if (get().playId !== playId) return;
          }

          const currentIndex = list.findIndex(item => item.id === playId);
          if (currentIndex === -1) return;

          const prevIndex = (currentIndex - 1 + list.length) % list.length;

          // 随机模式兜底顺序回退时，也要把当前歌推入前向队列，
          // 这样再按「下一首」还能回来，保持双向游标的完整性。
          if (playMode === PlayMode.Random) {
            set(state => {
              state.randomFuture.unshift(playId);
              state.playId = list[prevIndex].id;
            });
          } else {
            set(state => {
              state.playId = list[prevIndex].id;
            });
          }
        },
        addToNext: async ({
          type,
          title,
          bvid,
          sid,
          cover,
          ownerName,
          ownerMid,
          id,
          source,
          audioUrl,
          playCount,
          duration,
        }) => {
          const { playId, nextId: currentNextId, list } = get();
          const currentItem = list.find(item => item.id === playId);
          const sanitizedTitle = sanitizeTitle(title);
          const candidate = { type, bvid, sid, source, id };
          // 如果当前正在播放，则不添加
          if (isSame(candidate, currentItem)) {
            return;
          }

          // 如果下一首就是要添加的，则不添加
          if (currentNextId) {
            const currentNextItem = list.find(item => item.id === currentNextId);
            if (isSame(candidate, currentNextItem)) {
              return;
            }
          }

          // 列表已存在
          const existItemIndex = list?.findIndex(item => isSame(item, candidate)) ?? -1;
          if (existItemIndex !== -1) {
            set(state => {
              state.nextId = list[existItemIndex].id;
              // 将已存在项移动到下一首
              const currentItemIndex = list.findIndex(item => item.id === playId);
              if (currentItemIndex !== existItemIndex - 1) {
                state.list.splice(existItemIndex, 1);
                state.list.splice(currentItemIndex, 0, list[existItemIndex]);
              }
            });
            return;
          }

          let nextPlayItem: PlayData[] =
            source === "local" && id
              ? [
                  {
                    id,
                    type,
                    bvid,
                    sid,
                    source,
                    audioUrl,
                    title: sanitizedTitle,
                    cover: cover ? formatUrlProtocol(cover) : undefined,
                    ownerName,
                    ownerMid,
                    duration,
                  },
                ]
              : [
                  {
                    id: idGenerator(),
                    type,
                    bvid,
                    sid,
                    title: sanitizedTitle,
                    cover: cover ? formatUrlProtocol(cover) : undefined,
                    ownerName,
                    ownerMid,
                    playCount,
                    duration,
                  },
                ];
          if (source !== "local" && (!cover || !ownerName || !ownerMid)) {
            if (type === "mv" && bvid) {
              nextPlayItem = await getMVData(bvid);
            }

            if (type === "audio" && sid) {
              nextPlayItem = await getAudioData(sid);
            }
          }

          if (!nextPlayItem || nextPlayItem.length === 0) {
            toastError("添加失败：无法获取播放信息");
            return;
          }

          const nextId = nextPlayItem[0].id;
          // 空列表，直接播放
          if (list.length === 0) {
            set({
              playId: nextId,
              list: nextPlayItem,
              isPlaying: isOfflineDemo,
            });
            return;
          }

          // 当前播放的是音频，则直接插入到其后面
          if (currentItem?.type === "audio") {
            set(state => {
              state.nextId = nextId;
              const currentItemIndex = list.findIndex(item => item.id === state.playId);
              state.list.splice(currentItemIndex + 1, 0, ...nextPlayItem);
            });
          }

          // 当前播放的是视频，找到最后一个分集的索引，插入到其后面
          if (currentItem?.type === "mv") {
            const currentMVLastPageIndex = list.findLastIndex(item =>
              isSame(item, { type: "mv", bvid: currentItem.bvid }),
            );
            set(state => {
              state.nextId = nextId;
              state.list.splice(currentMVLastPageIndex + 1, 0, ...nextPlayItem);
            });
          }
        },
        addList: async items => {
          const { list, playId } = get();
          if (list.length === 0) {
            get().playList(items);
            return;
          }

          const currentItem = list.find(item => item.id === playId);

          const paddingItems = items
            .filter(item => {
              if (currentItem && isSame(item, currentItem)) {
                return false;
              }
              return !list.some(existing => isSame(existing, item));
            })
            .map(item => ({
              ...item,
              title: sanitizeTitle(item.title),
              id: item.source === "local" && item.id ? item.id : idGenerator(),
            }));

          if (paddingItems.length === 0) {
            return;
          }

          set({
            list: [...list, ...paddingItems],
          });
        },
        delPage: async id => {
          if (get().list.length === 1) {
            get().clear();
            return;
          }

          if (id === get().playId) {
            try {
              await get().next();
            } catch (error) {
              handlePlayError(error);
            }
          }

          set(state => {
            const removeIndex = state.list.findIndex(item => item.id === id);
            if (removeIndex !== -1) {
              state.list.splice(removeIndex, 1);
            }
            state.randomHistory = state.randomHistory.filter(hId => hId !== id);
            state.randomFuture = state.randomFuture.filter(fId => fId !== id);
            state.randomPlayedIds = state.randomPlayedIds.filter(pId => pId !== id);
          });
        },
        del: async id => {
          if (get().list.length === 1) {
            get().clear();
            return;
          }

          const { playId, list } = get();
          const playItem = list.find(item => item.id === playId);
          const removedItem = list.find(item => item.id === id);

          if (isSame(playItem, removedItem)) {
            if (removedItem?.type === "audio") {
              try {
                await get().next();
              } catch (error) {
                handlePlayError(error);
              }
            } else {
              if (list.some(item => !isSame(item, removedItem))) {
                const lastIndex = list.findLastIndex(item => isSame(item, removedItem));
                if (lastIndex !== -1) {
                  const nextPlayIndex = (lastIndex + 1) % list.length;
                  set(state => {
                    state.playId = state.list[nextPlayIndex].id;
                  });
                }
              } else {
                get().clear();
                return;
              }
            }
          }

          set(state => {
            // 先收集将被删除的 id，再执行删除
            const removedIds = new Set(state.list.filter(item => isSame(item, removedItem)).map(item => item.id));
            remove(state.list, item => isSame(item, removedItem));
            state.randomHistory = state.randomHistory.filter(hId => !removedIds.has(hId));
            state.randomFuture = state.randomFuture.filter(fId => !removedIds.has(fId));
            state.randomPlayedIds = state.randomPlayedIds.filter(pId => !removedIds.has(pId));
          });
        },
        clear: () => {
          const currentPlayItem = get().getPlayItem?.();
          if (shouldReportPlayRecord(currentPlayItem)) {
            endPlayReport();
          }
          if (audio) {
            setAudioSource(""); // 同时 abort 可能在跑的 MSE 挂载
            if (!audio.paused) {
              audio.pause();
            }
          }
          set(state => {
            state.isPlaying = false;
            state.duration = undefined;
            state.list = [];
            state.playId = undefined;
            state.nextId = undefined;
            state.randomHistory = [];
            state.randomFuture = [];
            state.randomPlayedIds = [];
          });
          usePlayProgress.getState().setCurrentTime(0);
        },
        getPlayItem: () => {
          const { playId, list } = get();
          const playItem = list.find(item => item.id === playId);
          return playItem;
        },
        getAudio: () => audio,
        setCustomArtist: (id, artist) => {
          set(state => {
            const item = state.list.find(i => i.id === id);
            if (item) {
              item.customArtist = artist;
            }
          });
        },
        renameTrack: (target, newTitle) => {
          set(state => {
            for (const item of state.list) {
              if (isSame(item, target)) {
                item.title = newTitle;
                // 播放栏/精美播放器显示 pageTitle || title（本地歌单曲目的显示名可能
                // 落在 pageTitle 上，如多P分集或收藏时调整的名字），存在时一并更新才会生效
                if (item.pageTitle !== undefined) {
                  item.pageTitle = newTitle;
                }
              }
            }
          });
        },
      };
    }),
    {
      name: "play-list-store",
      // v1：移除「顺序播放」（旧枚举值 1）。已持久化为顺序播放的机器回落到循环播放，
      // 否则 playMode=1 不再匹配任何分支，播完当前歌将无法自动续播。
      // v2：同源媒体 token 只对当前 Web 服务进程有效，持久队列恢复时必须重新解析。
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as { list?: PlayData[]; playMode?: number } | undefined;
        if (state && version < 1 && state.playMode === 1) {
          state.playMode = PlayMode.Loop;
        }
        if (state?.list && version < 2) {
          state.list = state.list.map(sanitizePersistedPlaybackUrls);
        }
        return state as never;
      },
      partialize: state => ({
        isMuted: state.isMuted,
        volume: state.volume,
        playMode: state.playMode,
        rate: state.rate,
        duration: state.duration,
        list: state.list.map(sanitizePersistedPlaybackUrls),
        playId: state.playId,
        nextId: state.nextId,
        shouldKeepPagesOrderInRandomPlayMode: state.shouldKeepPagesOrderInRandomPlayMode,
      }),
    },
  ),
);

/** 换源自救状态：当前歌曲已试过的音频地址，切歌后自动重置 */
let failoverPlayId: string | undefined;
let failoverTriedUrls = new Set<string>();
let failoverRefreshed = false;
let failoverAttempts = 0;
let lastFailoverAt = 0;

/**
 * 换源自救的节流参数。
 *
 * 背景：弱网 / 播放源整体不可用时（手机网页最容易复现），备用地址会一个接一个
 * 秒失败，原实现不带任何间隔与次数上限，于是「换源 → 立刻再失败 → 再换源」在
 * 一秒内跑完所有候选，再连锁跳过整张歌单，对 B 站接口形成短时高频请求，
 * 既刷屏也有被风控的风险。这里给自救链路加上最小间隔 + 次数上限 + 跳歌退避。
 */
const FAILOVER_MIN_INTERVAL_MS = 2000;
/** 单曲最多换几次源（含重新取地址），超过就交给跳过逻辑 */
const FAILOVER_MAX_ATTEMPTS = 3;
/** 自动跳下一首前的等待，避免整张列表在一秒内被烧完 */
const AUTO_SKIP_DELAY_MS = 1500;
/** 连续多少首失败后停手（原来是整张列表长度，几百首时等同于无限刷请求） */
const MAX_CONSECUTIVE_SKIPS = 3;

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * 播放失败时探一次真实 HTTP 状态码。
 *
 * 手机上没法开开发者工具看 Network，媒体元素的 onerror 又只给 code=2/3/4 这种
 * 笼统分类，排查时等于瞎子。这里对失败地址发一个 1 字节 Range 请求，把状态码
 * 写进日志和提示里（404 = 代理 token 失效、403 = 上游拒绝、0 = 网络不通）。
 * 每首歌只在重新取址那一步探一次，不会增加请求压力。
 */
async function probePlaybackStatus(url: string): Promise<number | undefined> {
  if (typeof fetch !== "function") return undefined;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Range: "bytes=0-0" },
      method: "GET",
    });
    // 只关心状态码，正文立刻丢弃
    void res.body?.cancel();
    return res.status;
  } catch {
    return 0; // 请求根本没发出去 / 被网络层掐断
  }
}

/** 距上次换源不足最小间隔时补齐等待，把失败风暴摊平成低频重试 */
async function waitFailoverSlot() {
  const elapsed = Date.now() - lastFailoverAt;
  if (elapsed < FAILOVER_MIN_INTERVAL_MS) {
    await delay(FAILOVER_MIN_INTERVAL_MS - elapsed);
  }
  lastFailoverAt = Date.now();
}

/**
 * 播放出错时的换源自救（对齐官方播放器行为）：先逐个换没试过的候选地址，
 * 候选用尽后再重新向 B 站取一次新地址；都失败才返回 false，由调用方跳下一首兜底。
 * 只在真实播放失败时触发，每个地址最多试一次、新地址最多重取一次，不会产生轮询压力。
 */
async function tryFailoverAudioSource(playId: string, failedSrc: string): Promise<boolean> {
  if (failoverPlayId !== playId) {
    failoverPlayId = playId;
    failoverTriedUrls = new Set();
    failoverRefreshed = false;
    failoverAttempts = 0;
  }
  // 浏览器在等新手势：换源同样要 play()，注定被拒，直接停手
  if (awaitingUserGesture) return false;
  // 本曲自救次数用尽：不再继续换源，避免坏源上无休止地重试
  if (failoverAttempts >= FAILOVER_MAX_ATTEMPTS) return false;
  if (failedSrc) {
    failoverTriedUrls.add(normalizePlaybackUrl(failedSrc));
  }

  const state = usePlayList.getState();
  // 出错后用户已切歌：按已处理返回，避免误跳下一首
  if (state.playId !== playId) return true;
  const playItem = state.getPlayItem?.();
  // 本地文件没有备用源可换
  if (!playItem || playItem.source === "local") return false;

  const resumeTime = usePlayProgress.getState().currentTime || 0;

  // 网页版所有候选地址都是同一个同源代理会话签出的 token，token 失效（服务重启 / 过期 /
  // 会话轮换）时逐个试候选必然全军覆没，只是白白多打几次请求。直接重新取址即可。
  const shouldRefreshFirst = isBilibiliMediaProxyUrl(failedSrc) && !failoverRefreshed;

  const nextUrl = shouldRefreshFirst
    ? undefined
    : playItem.audioUrlCandidates?.find(url => !failoverTriedUrls.has(normalizePlaybackUrl(url)));
  if (nextUrl) {
    log.warn("音频播放失败，自动切换备用地址重试", { playId });
    failoverTriedUrls.add(normalizePlaybackUrl(nextUrl));
    failoverAttempts += 1;
    toastInfo("播放卡顿，正在切换播放源…");
    await waitFailoverSlot();
    // 等待期间用户可能已切歌 / 暂停，这时不要抢占当前播放
    if (usePlayList.getState().playId !== playId) return true;
    resumeAudioFrom(nextUrl, resumeTime);
    return true;
  }

  if (!failoverRefreshed) {
    failoverRefreshed = true;
    failoverAttempts += 1;
    const status = await probePlaybackStatus(failedSrc);
    log.warn("音频播放失败，重新获取播放地址重试", { playId, failedSrc, httpStatus: status });
    if (status === 0) {
      toastInfo("播放源连不上，请检查网络");
    } else if (status !== undefined && status >= 400) {
      toastInfo(`播放源失效（HTTP ${status}），正在重新获取…`);
    }
    await waitFailoverSlot();
    if (usePlayList.getState().playId !== playId) return true;
    const refreshed = await refreshCurrentAudioSource();
    // 用 currentSourceUrl 而非 audio.src：MSE 下 audio.src 是 blob，拿不到真实地址
    if (refreshed && currentSourceUrl && !failoverTriedUrls.has(normalizePlaybackUrl(currentSourceUrl))) {
      failoverTriedUrls.add(normalizePlaybackUrl(currentSourceUrl));
      toastInfo("播放卡顿，正在重新获取播放源…");
      // refreshCurrentAudioSource 已经把源设置好（含 seek），这里直接播
      seekOnMetadata(resumeTime);
      void playAudioSafely();
      return true;
    }
  }

  return false;
}

/**
 * 从指定地址续播：保留中断前的播放进度，换源重试时不从头播。
 *
 * 注意 seek 必须等 loadedmetadata：刚 load() 完时 duration 还是 NaN，
 * 此时写 currentTime 在 iOS 的 WebKit 上会被丢弃甚至打断这次加载
 * （iOS 上所有浏览器都是 WKWebView，Chrome 同样受影响）。
 */
function resumeAudioFrom(url: string, resumeTime: number) {
  // 换源续播：iOS 走 MSE、其余直连，seek 交给 setAudioSource 在 loadedmetadata 后执行
  const item = usePlayList.getState().getPlayItem?.();
  setAudioSource(url, {
    audioCodecs: item?.audioCodecs,
    audioBandwidth: item?.audioBandwidth,
    duration: item?.duration,
    isDolby: item?.isDolby,
    isLossless: item?.isLossless,
    resumeTime: resumeTime > 0 ? resumeTime : undefined,
  });
  void playAudioSafely();
}

/**
 * 统一的定位入口。除了切歌前的清零，**任何地方都不要直接写 `audio.currentTime`**。
 *
 * MSE 只能从文件头顺序喂，播放头一旦被写到还没喂到的位置就落在缓冲区之外：元素永远
 * 等不到数据（无声），喂流侧还会把正在喂的数据当成"已播过"驱逐掉、被 WebKit 当成
 * 远离播放头的垃圾拒收（QuotaExceededError）。2026-08-26 线上那次「播到一半突然无声、
 * 二十多秒后靠回退直连自己救回来」就是这么来的。
 *
 * 所以 MSE 下的定位必须带着目标时间重挂：喂流器用 HTTP Range 直接从目标片段取流，
 * 并且只在数据真的覆盖到目标之后才落实 seek（见 media-source.ts 的 applyPendingSeek）。
 * 目标已经在缓冲区里时则直接写，瞬时生效——这是最常见的小幅拖动。
 */
function seekAudioTo(time: number) {
  if (!audio) return;
  cancelPendingRemountSeek();
  // 目标已在缓冲区内（或本来就是直连）：直接写，瞬时生效。拖动进度条时绝大多数落在这里。
  if (!activeMediaSourceController || isTimeBuffered(time)) {
    clearPendingSeekDisplay();
    audio.currentTime = time;
    return;
  }
  // 需要重新取流才够得着：等用户停手再动。进度条 Slider 的 onChange 在拖动过程中会连续
  // 触发，每一下都重挂就是每一下 2~3 个 Range 请求的挂载风暴。
  // 期间进度条停在目标位置，不要被旧位置的 timeupdate 拉回去。
  holdPendingSeekDisplay(time);
  remountSeekTimer = setTimeout(() => {
    remountSeekTimer = undefined;
    if (!activeMediaSourceController) {
      clearPendingSeekDisplay();
      return;
    }
    // 等待期间数据可能已经喂过来了，那就不用重挂
    if (isTimeBuffered(time)) {
      audio.currentTime = time;
      return;
    }
    // 已经在为同一个目标取流了（Slider 按下/抬起各发一次 onChange，间隔常超过防抖窗）
    if (Math.abs(currentMountStartTime - time) < 1) return;
    const wasPlaying = !audio.paused;
    const item = usePlayList.getState().getPlayItem?.();
    setAudioSource(currentSourceUrl, {
      audioCodecs: item?.audioCodecs,
      audioBandwidth: item?.audioBandwidth,
      duration: item?.duration,
      isDolby: item?.isDolby,
      isLossless: item?.isLossless,
      resumeTime: time,
    });
    if (wasPlaying) void playAudioSafely();
  }, REMOUNT_SEEK_DEBOUNCE_MS);
}

const audioSourceRefreshFlights = new Map<string, Promise<boolean>>();

export function refreshCurrentAudioSource(): Promise<boolean> {
  const { getPlayItem, playId: requestedPlayId } = usePlayList.getState?.() ?? {};
  const playItem = getPlayItem?.();
  if (!playItem || !requestedPlayId) return Promise.resolve(false);

  const existing = audioSourceRefreshFlights.get(requestedPlayId);
  if (existing) return existing;

  const refresh = resolveCurrentAudioSource(requestedPlayId, playItem).finally(() => {
    if (audioSourceRefreshFlights.get(requestedPlayId) === refresh) {
      audioSourceRefreshFlights.delete(requestedPlayId);
    }
  });
  audioSourceRefreshFlights.set(requestedPlayId, refresh);
  return refresh;
}

async function resolveCurrentAudioSource(requestedPlayId: string, playItem: PlayData): Promise<boolean> {
  try {
    if (playItem.type === "mv" && playItem.bvid && playItem.cid) {
      const mvPlayData = await getDashUrl(playItem.bvid, playItem.cid);
      if (usePlayList.getState().playId !== requestedPlayId) return false;
      if (mvPlayData?.audioUrl) {
        const resumeTime = usePlayProgress.getState().currentTime || 0;
        setAudioSource(mvPlayData.audioUrl, {
          audioCodecs: mvPlayData.audioCodecs,
          audioBandwidth: mvPlayData.audioBandwidth,
          duration: playItem.duration,
          isDolby: mvPlayData.isDolby,
          isLossless: mvPlayData.isLossless,
          resumeTime: resumeTime > 0 ? resumeTime : undefined,
        });
        usePlayList.setState(state => {
          if (state.playId !== requestedPlayId) return;
          const listItem = state.list.find(item => item.id === requestedPlayId);
          if (listItem) {
            listItem.audioUrl = mvPlayData.audioUrl;
            listItem.audioUrlCandidates = mvPlayData.audioUrlCandidates;
            listItem.videoUrl = mvPlayData.videoUrl;
            listItem.isLossless = mvPlayData.isLossless;
            listItem.isDolby = mvPlayData.isDolby;
            listItem.audioCodecs = mvPlayData.audioCodecs;
            listItem.audioBandwidth = mvPlayData.audioBandwidth;
          }
        });
        return true;
      }
    }

    if (playItem.type === "audio" && playItem.sid) {
      const musicPlayData = await getAudioUrl(playItem.sid);
      if (usePlayList.getState().playId !== requestedPlayId) return false;
      if (musicPlayData?.audioUrl) {
        const resumeTime = usePlayProgress.getState().currentTime || 0;
        setAudioSource(musicPlayData.audioUrl, {
          audioCodecs: musicPlayData.audioCodecs,
          duration: playItem.duration,
          isLossless: musicPlayData.isLossless,
          resumeTime: resumeTime > 0 ? resumeTime : undefined,
        });
        usePlayList.setState(state => {
          if (state.playId !== requestedPlayId) return;
          const listItem = state.list.find(item => item.id === requestedPlayId);
          if (listItem) {
            listItem.audioUrl = musicPlayData.audioUrl;
            listItem.audioUrlCandidates = musicPlayData.audioUrlCandidates;
            listItem.isLossless = musicPlayData.isLossless;
          }
        });
        return true;
      }
    }
  } catch (refreshError) {
    log.error("刷新播放链接失败", {
      playItem,
      refreshError,
    });
    handlePlayError(refreshError);
  }

  return false;
}

function resetAudioAndPlay(url: string) {
  // 从头播：不带 resumeTime，iOS 走 MSE、其余直连
  const item = usePlayList.getState().getPlayItem?.();
  setAudioSource(url, {
    audioCodecs: item?.audioCodecs,
    audioBandwidth: item?.audioBandwidth,
    isDolby: item?.isDolby,
    isLossless: item?.isLossless,
  });
  void playAudioSafely();
}

/**
 * 拿不到播放地址时，确认当前歌曲是否已被 B 站删除 / 下架（永久失效），
 * 若确认失效则提示用户、把它从播放列表移除并自动跳到下一首；
 * 无法确认（网络故障等临时问题）则保守地不处理，沿用原有报错提示。
 *
 * 解决的问题：长期不变更的播放列表里，部分视频被 UP 主或 B 站删除后，
 * 播到那首歌会因为取不到播放地址而卡死。这里用接口明确的「失效码」判定
 * （区别于网络超时等临时故障，避免误删），命中后复用 del() 的「删当前歌→自动续播」逻辑。
 * 若紧接着的下一首同样失效，会在它成为当前歌时再次触发，从而连续跳过多首失效歌曲。
 *
 * @returns 是否已作为失效处理（true 时调用方无需再提示 / 重试）
 */
async function dropCurrentIfInvalid(playId: string, playItem: PlayData): Promise<boolean> {
  let gone = false;
  try {
    if (playItem.type === "mv" && playItem.bvid) {
      const res = await getWebInterfaceView({ bvid: playItem.bvid });
      gone = isResourceGoneCode(res?.code);
    } else if (playItem.type === "audio" && playItem.sid) {
      const res = await getAudioSongInfo({ sid: playItem.sid });
      gone = isResourceGoneCode(res?.code);
    }
  } catch {
    return false; // 无法确认是否失效：保守处理，不删
  }

  if (!gone) return false;

  const state = usePlayList.getState();
  // 确认期间用户已切歌：不再处理，避免误删用户正在听的歌
  if (state.playId !== playId) return true;

  log.warn("歌曲已失效，自动从播放列表移除并跳过", {
    playId,
    bvid: playItem.bvid,
    sid: playItem.sid,
    title: playItem.title,
  });
  const markedLocalFavorites = useLocalFavItemsStore.getState().markInvalidByPlayback(playItem);
  toastInfo(
    `「${playItem.title || "该歌曲"}」已失效，已自动移除${markedLocalFavorites ? "，已在本地收藏夹标记失效" : ""}`,
  );
  await state.del(playId);
  return true;
}

/**
 * 播完前多久开始预取下一首的播放地址（秒）。
 *
 * 手机锁屏/切后台时，页面 JS 会被系统冻结或大幅降频；一旦 `ended` 之后还要**先发网络请求**
 * 去解析下一首的地址，这个异步过程在后台常常跑不完（或者跑完时音频会话已经失活，
 * 非手势的 play() 被拒），表现就是「黑屏后当前这首播完就停了」。
 *
 * 解法是把网络请求提前到还在播放的时候做完：`ended` 触发时下一首的地址已经在列表项里，
 * 切歌链路是**纯同步**的（setAudioSource + play() 在同一个任务里完成），
 * 音频会话不中断，后台续播才稳。
 */
const PREFETCH_LEAD_SECONDS = 25;

/** 已经预取过的「当前歌 → 下一首」组合，避免 timeupdate 每秒重复触发 */
let prefetchedPairKey: string | undefined;

/** 当前歌播到尾声时，提前把下一首的播放地址取好写回列表项 */
function maybePrefetchNextSource(currentTime: number, peekNextPlayId: () => string | undefined) {
  const duration = audio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  if (duration - currentTime > PREFETCH_LEAD_SECONDS) return;

  const playId = usePlayList.getState().playId;
  if (!playId) return;
  const nextPlayId = peekNextPlayId();
  if (!nextPlayId) return;

  const pairKey = `${playId}->${nextPlayId}`;
  if (prefetchedPairKey === pairKey) return;
  prefetchedPairKey = pairKey;
  void prefetchAudioSource(nextPlayId);
}

/**
 * 静默解析某首歌的播放地址并写回列表项（不碰 audio 元素、不弹提示）。
 * 失败只记日志：真正的失败处理仍由切到这首歌之后的既有链路负责。
 */
async function prefetchAudioSource(targetPlayId: string) {
  const playItem = usePlayList.getState().list.find(item => item.id === targetPlayId);
  if (!playItem) return;
  // 本地文件无需解析；地址还没过期也不用重取
  if (playItem.source === "local") return;
  if (isUrlValid(playItem.audioUrl)) return;

  const applyToItem = (patch: Partial<PlayData>) => {
    usePlayList.setState(state => {
      const listItem = state.list.find(item => item.id === targetPlayId);
      if (listItem) Object.assign(listItem, patch);
    });
  };

  try {
    if (playItem.type === "audio" && playItem.sid) {
      const musicPlayData = await getAudioUrl(playItem.sid);
      if (!musicPlayData?.audioUrl) return;
      applyToItem({
        audioUrl: musicPlayData.audioUrl,
        audioUrlCandidates: musicPlayData.audioUrlCandidates,
        audioCodecs: musicPlayData.audioCodecs,
        isLossless: musicPlayData.isLossless,
      });
      return;
    }

    if (playItem.type !== "mv" || !playItem.bvid) return;
    // 多P占位项还没解析出 cid：先补 cid，再取地址（否则切过去仍要走两次网络请求）
    let cid = playItem.cid;
    if (!cid) {
      const mvData = await getMVData(playItem.bvid);
      cid = mvData[0]?.cid;
      if (!cid) return;
      applyToItem({ cid });
    }
    const mvPlayData = await getDashUrl(playItem.bvid, cid);
    if (!mvPlayData?.audioUrl) return;
    applyToItem({
      audioUrl: mvPlayData.audioUrl,
      audioUrlCandidates: mvPlayData.audioUrlCandidates,
      videoUrl: mvPlayData.videoUrl,
      audioCodecs: mvPlayData.audioCodecs,
      audioBandwidth: mvPlayData.audioBandwidth,
      isDolby: mvPlayData.isDolby,
      isLossless: mvPlayData.isLossless,
    });
  } catch (error) {
    // 预取失败不影响当前播放：切过去时会走原有的解析/换源/跳过链路
    log.warn("预取下一首播放地址失败", { targetPlayId, error: String(error) });
  }
}

// 切换歌曲时，更新当前播放的歌曲信息
usePlayList.subscribe(async (state, prevState) => {
  if (state.playId !== prevState.playId) {
    if (isOfflineDemo) return;

    if (!state.playId) {
      const prevPlayItem = prevState.list.find(item => item.id === prevState.playId);
      if (shouldReportPlayRecord(prevPlayItem)) {
        endPlayReport();
      }
    }

    const nextPlayItem = state.playId ? state.list.find(item => item.id === state.playId) : undefined;
    // 地址已就绪（本地文件 / 已预取且未过期）：这条路是**纯同步**的，
    // 下面会立刻 setAudioSource + play()。手机锁屏后能否续播就取决于这里不出现异步空档。
    const readyUrl =
      nextPlayItem && audio.paused
        ? nextPlayItem.source === "local"
          ? nextPlayItem.audioUrl
          : isUrlValid(nextPlayItem.audioUrl)
            ? nextPlayItem.audioUrl
            : undefined
        : undefined;

    if (audio && !audio.paused) {
      audio.pause();
    }
    if (audio && !readyUrl) {
      audio.currentTime = 0;
      // 新歌地址尚未解析完成时，不能保留旧 src；否则用户在这个间隙点播放会恢复上一首。
      // 反之地址已就绪时**不要**清空：清空 src 会中断音频会话，锁屏下再 play() 会被浏览器拒。
      setAudioSource(""); // 同时 abort 可能在跑的 MSE 挂载
    }
    usePlayProgress.getState().setCurrentTime(0);
    // 切换歌曲
    if (state.playId) {
      const requestedPlayId = state.playId;
      const playItem = state.list.find(item => item.id === state.playId);
      if (playItem) {
        if (shouldReportPlayRecord(playItem)) {
          void beginPlayReport(playItem);
        }
      }
      if (readyUrl && playItem) {
        // 锁屏时也要把标题/封面更新到系统媒体控制中心，否则显示的还是上一首
        updateMediaSession({
          title: playItem.pageTitle || playItem.title,
          artist: playItem.ownerName,
          cover: playItem.pageCover || playItem.cover,
        });
        resetAudioAndPlay(readyUrl);
        return;
      }

      if (playItem?.type === "mv") {
        if (playItem?.bvid && playItem?.cid) {
          const mvPlayData = await getDashUrl(playItem.bvid, playItem.cid);
          if (usePlayList.getState().playId !== requestedPlayId) return;
          if (mvPlayData?.audioUrl) {
            resetAudioAndPlay(mvPlayData?.audioUrl);

            updateMediaSession({
              title: playItem.pageTitle || playItem.title,
              artist: playItem.ownerName,
              cover: playItem.pageCover,
            });

            usePlayList.setState(state => {
              if (state.playId !== requestedPlayId) return;
              const listItem = state.list.find(item => item.id === requestedPlayId);
              if (listItem) {
                listItem.audioUrl = mvPlayData?.audioUrl;
                listItem.audioUrlCandidates = mvPlayData?.audioUrlCandidates;
                listItem.videoUrl = mvPlayData?.videoUrl;
                listItem.isLossless = mvPlayData?.isLossless;
                listItem.audioCodecs = mvPlayData?.audioCodecs;
                listItem.audioBandwidth = mvPlayData?.audioBandwidth;
                listItem.isDolby = mvPlayData?.isDolby;
              }
            });
          } else {
            log.error("无法获取音频播放链接", {
              type: "mv",
              bvid: playItem.bvid,
              cid: playItem.cid,
              title: playItem.title,
              mvPlayData,
            });
            if (!(await dropCurrentIfInvalid(playItem.id, playItem))) {
              toastError("无法获取音频播放链接");
            }
          }
        } else if (playItem?.bvid) {
          const mvData = await getMVData(playItem.bvid);
          if (usePlayList.getState().playId !== requestedPlayId) return;
          const [firstMV, ...restMV] = mvData;
          if (firstMV?.cid) {
            const mvPlayData = await getDashUrl(playItem.bvid, firstMV.cid);
            if (usePlayList.getState().playId !== requestedPlayId) return;
            if (mvPlayData?.audioUrl) {
              let applied = false;
              usePlayList.setState(state => {
                if (state.playId !== playItem.id) return;
                const listItemIndex = state.list.findIndex(item => item.id === state.playId);
                if (listItemIndex < 0) return;
                state.list.splice(
                  listItemIndex,
                  1,
                  {
                    ...firstMV,
                    // 保留占位项 id，避免解析多P后改变 playId 再触发一次订阅与媒体请求。
                    id: playItem.id,
                    ...{
                      audioUrl: mvPlayData?.audioUrl,
                      audioUrlCandidates: mvPlayData?.audioUrlCandidates,
                      videoUrl: mvPlayData?.videoUrl,
                      isLossless: mvPlayData?.isLossless,
                      isDolby: mvPlayData?.isDolby,
                      audioCodecs: mvPlayData?.audioCodecs,
                      audioBandwidth: mvPlayData?.audioBandwidth,
                    },
                  },
                  ...restMV,
                );
                applied = true;
              });
              if (!applied) return;

              updateMediaSession({
                title: firstMV.pageTitle || firstMV.title,
                artist: firstMV.ownerName,
                cover: firstMV.pageCover,
              });
              resetAudioAndPlay(mvPlayData?.audioUrl);
            } else {
              log.error("无法获取音频播放链接", {
                type: "mv",
                bvid: playItem.bvid,
                cid: firstMV.cid,
                title: firstMV.title,
                mvPlayData,
              });
              if (!(await dropCurrentIfInvalid(playItem.id, playItem))) {
                toastError("无法获取音频播放链接");
              }
            }
          } else {
            log.error("无法获取音频播放链接", {
              type: "mv",
              bvid: playItem.bvid,
              title: playItem.title,
              mvData,
            });
            if (!(await dropCurrentIfInvalid(playItem.id, playItem))) {
              toastError("无法获取音频播放链接");
            }
          }
        }
      }

      if (playItem?.type === "audio" && playItem?.sid) {
        const musicPlayData = await getAudioUrl(playItem.sid);
        if (usePlayList.getState().playId !== requestedPlayId) return;
        if (musicPlayData?.audioUrl) {
          resetAudioAndPlay(musicPlayData?.audioUrl);

          updateMediaSession({
            title: playItem.title,
            artist: playItem.ownerName,
            cover: playItem.pageCover,
          });

          usePlayList.setState(state => {
            if (state.playId !== requestedPlayId) return;
            const listItem = state.list.find(item => item.id === requestedPlayId);
            if (listItem) {
              listItem.audioUrl = musicPlayData?.audioUrl;
              listItem.audioUrlCandidates = musicPlayData?.audioUrlCandidates;
            }
          });
        } else {
          log.error("无法获取音频播放链接", {
            type: "audio",
            sid: playItem.sid,
            title: playItem.title,
            musicPlayData,
          });
          if (!(await dropCurrentIfInvalid(playItem.id, playItem))) {
            toastError("无法获取音频播放链接");
          }
        }
      }
    }
  }
});
