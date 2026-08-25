import { addToast } from "@heroui/react";
import { remove } from "es-toolkit/array";
import { uniqueId } from "es-toolkit/compat";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { getPlayModeList, PlayMode } from "@/common/constants/audio";
import { getAudioUrl, getDashUrl, isResourceGoneCode, isUrlValid } from "@/common/utils/audio";
import { resumeAudioGraph } from "@/common/utils/audio-graph";
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
  del: (id: string) => void;
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
const primeAudioForGesture = () => {
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

const updatePlaybackState = () => {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  }

  if (platform && platform.updatePlaybackState) {
    platform.updatePlaybackState(!audio.paused);
  }
};

const playAudioSafely = async () => {
  try {
    await audio.play();
  } catch (error) {
    if ((error as DOMException)?.name === "NotSupportedError") {
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

export const usePlayList = create<State & Action>()(
  persist(
    immer((set, get) => {
      const ensureAudioSrcValid = async () => {
        const { playId, list } = get();
        const currentPlayItem = list.find(item => item.id === playId);
        if (currentPlayItem?.source === "local" && currentPlayItem?.audioUrl) {
          if (!isSamePlaybackUrl(audio.src, currentPlayItem.audioUrl)) {
            audio.src = currentPlayItem.audioUrl;
          }
          const currentTime = usePlayProgress.getState().currentTime;
          if (typeof currentTime === "number" && currentTime > 0) {
            audio.currentTime = currentTime;
          }
          return;
        }
        if (isUrlValid(currentPlayItem?.audioUrl)) {
          if (!isSamePlaybackUrl(audio.src, currentPlayItem.audioUrl)) {
            audio.src = currentPlayItem.audioUrl;
          }
          const currentTime = usePlayProgress.getState().currentTime;
          if (typeof currentTime === "number" && currentTime > 0) {
            audio.currentTime = currentTime;
          }
          return;
        }

        if (currentPlayItem?.type === "mv" && currentPlayItem?.bvid && currentPlayItem?.cid) {
          const mvPlayData = await getDashUrl(currentPlayItem.bvid, currentPlayItem.cid);
          if (get().playId !== playId) return;
          if (mvPlayData?.audioUrl) {
            if (!isSamePlaybackUrl(audio.src, mvPlayData.audioUrl)) {
              audio.src = mvPlayData.audioUrl;
              const currentTime = usePlayProgress.getState().currentTime;
              if (typeof currentTime === "number") {
                audio.currentTime = currentTime;
              }
            }
            set(state => {
              const listItem = state.list.find(item => item.id === playId);
              if (listItem) {
                listItem.audioUrl = mvPlayData.audioUrl;
                listItem.audioUrlCandidates = mvPlayData.audioUrlCandidates;
                listItem.videoUrl = mvPlayData.videoUrl;
                listItem.isLossless = mvPlayData.isLossless;
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
            if (!isSamePlaybackUrl(audio.src, musicPlayData.audioUrl)) {
              audio.src = musicPlayData.audioUrl;
              const currentTime = usePlayProgress.getState().currentTime;
              if (typeof currentTime === "number") {
                audio.currentTime = currentTime;
              }
            }
            set(state => {
              const listItem = state.list.find(item => item.id === playId);
              if (listItem) {
                listItem.audioUrl = musicPlayData.audioUrl;
                listItem.audioUrlCandidates = musicPlayData.audioUrlCandidates;
                listItem.isLossless = musicPlayData.isLossless;
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
          if (audio) {
            audio.volume = get().volume;
            audio.muted = get().isMuted;
            audio.playbackRate = get().rate;
            audio.loop = get().playMode === PlayMode.Single;

            // 连续播放失败计数：自动跳过坏曲时，避免整个列表都失效时无限循环 next()
            let consecutiveErrorCount = 0;

            // 卡死看门狗：进入缓冲后超时仍无任何进度（坏源常见表现是不报错只挂起），
            // 视为播放失败触发换源自救；期间有进度推进则视为网络慢，重新计时观察
            const STALL_TIMEOUT_MS = 8000;
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
              stallWatchdog = setTimeout(() => {
                stallWatchdog = undefined;
                if (get().playId !== playId || audio.paused) return;
                if (audio.currentTime !== positionAtArm) {
                  armStallWatchdog();
                  return;
                }
                log.warn("播放长时间无进度，触发换源自救", { playId, src: audio.src, position: positionAtArm });
                void handlePlaybackFailure(playId, audio.src, { message: "stall watchdog timeout" });
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

              log.error("音频播放失败，自动跳到下一首", { playId, src: failedSrc, ...errInfo });
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
              usePlayProgress.getState().setCurrentTime(currentTime);
              const playItem = get().getPlayItem?.();
              if (shouldReportPlayRecord(playItem)) {
                void reportHeartbeat(playItem, currentTime, audio.duration, 0);
              }
            };

            audio.onseeked = () => {
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

              void handlePlaybackFailure(playId, audio.src, { code: err.code, message: err.message });
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
                await ensureAudioSrcValid();

                const localCurrentTime = usePlayProgress.getState().initCurrentTime();
                if (localCurrentTime) {
                  audio.currentTime = localCurrentTime;
                }

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
          if (audio) {
            audio.currentTime = s;
          }
        },
        togglePlay: async () => {
          primeAudioForGesture();
          if (!get().list?.length) {
            return;
          }

          if (!get().playId) {
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
                audio.currentTime = 0;
                await playAudioSafely();
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
                audio.currentTime = 0;
                await playAudioSafely();
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
            audio.src = "";
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
    if (refreshed && !failoverTriedUrls.has(normalizePlaybackUrl(audio.src))) {
      failoverTriedUrls.add(normalizePlaybackUrl(audio.src));
      toastInfo("播放卡顿，正在重新获取播放源…");
      resumeAudioFrom(audio.src, resumeTime);
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
  audio.src = url;
  audio.load();
  if (resumeTime > 0) {
    const seekOnce = () => {
      audio.removeEventListener("loadedmetadata", seekOnce);
      if (isSamePlaybackUrl(audio.src, url)) {
        audio.currentTime = resumeTime;
      }
    };
    audio.addEventListener("loadedmetadata", seekOnce);
  }
  void playAudioSafely();
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
        audio.src = mvPlayData.audioUrl;
        usePlayList.setState(state => {
          if (state.playId !== requestedPlayId) return;
          const listItem = state.list.find(item => item.id === requestedPlayId);
          if (listItem) {
            listItem.audioUrl = mvPlayData.audioUrl;
            listItem.audioUrlCandidates = mvPlayData.audioUrlCandidates;
            listItem.videoUrl = mvPlayData.videoUrl;
            listItem.isLossless = mvPlayData.isLossless;
            listItem.isDolby = mvPlayData.isDolby;
          }
        });
        return true;
      }
    }

    if (playItem.type === "audio" && playItem.sid) {
      const musicPlayData = await getAudioUrl(playItem.sid);
      if (usePlayList.getState().playId !== requestedPlayId) return false;
      if (musicPlayData?.audioUrl) {
        audio.src = musicPlayData.audioUrl;
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
  audio.src = url;
  audio.currentTime = 0;
  audio.load();
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

// 切换歌曲时，更新当前播放的歌曲信息
usePlayList.subscribe(async (state, prevState) => {
  if (state.playId !== prevState.playId) {
    if (!state.playId) {
      const prevPlayItem = prevState.list.find(item => item.id === prevState.playId);
      if (shouldReportPlayRecord(prevPlayItem)) {
        endPlayReport();
      }
    }

    if (audio && !audio.paused) {
      audio.pause();
    }
    if (audio) {
      audio.currentTime = 0;
      // 新歌地址尚未解析完成时，不能保留旧 src；否则用户在这个间隙点播放会恢复上一首。
      audio.src = "";
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
      if (playItem?.source === "local" && playItem?.audioUrl && audio.paused) {
        resetAudioAndPlay(playItem.audioUrl);
        return;
      }
      if (isUrlValid(playItem?.audioUrl) && audio.paused) {
        resetAudioAndPlay(playItem.audioUrl);
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
