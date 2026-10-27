import { useCallback, useEffect, useMemo, useRef } from "react";

import { adoptAlignment, alignmentToLines, isUserChosen, restorePreAlign } from "@/components/lyrics/alignment";
import {
  AUTO_MATCH_VERSION,
  autoMatchLyrics,
  type AutoLyricsResult,
  type AutoMatchOutcome,
} from "@/components/lyrics/auto-match";
import { parseLrc } from "@/components/lyrics/parse-lrc";
import { readPlaybackMs, useActiveLyricIndex } from "@/components/lyrics/playback-clock";
import { linesOfEntry } from "@/components/lyrics/provider-lyrics";
import { looksLikeTianci, recognizeFromScreen, screenOriginOf } from "@/components/lyrics/tianci";
import { DESKTOP_LYRICS_CHANNEL } from "@/pages/desktop-lyrics";
import platform, { log } from "@/platform";
import { isNativeMobile } from "@/platform/detect";
import { getPublishedLyrics, getRecognizedLyrics, putRecognizedLyrics } from "@/service/lyrics-align";
import { alignInputOf, useLyricsAlignSession } from "@/store/lyrics-align-session";
import { useDisplayedLyrics, useLyricsState } from "@/store/lyrics-state";
import { usePlayList } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";
import { StoreNameMap } from "@shared/store";

// 桌面歌词窗在两条消息之间按自己的时钟外推；外推和实际进度差出这么多（拖动进度条、卡顿）就补发一条校准
const RESYNC_DRIFT_MS = 300;

const DEFAULT_OFFSET = 0;

/** 切歌后等待多久才开始自动匹配歌词 */
const AUTO_MATCH_DEBOUNCE_MS = 1500;

const autoMissed = new Set<string>();

// 查不到不影响播放：记日志后照常走本地缓存 / 自动匹配。每次打开都查，新发布的版本才能及时生效。
// 查询失败返回 undefined，和「确实没有」（null）分开：查不到时不能当成已下线把本地的逐字歌词撤掉
async function fetchPublished(bvid: string | undefined, cid: string) {
  if (!bvid) return null;
  try {
    return (await getPublishedLyrics(bvid, cid)).alignment;
  } catch (err) {
    log.warn("[lyrics] 查询对所有人生效的歌词失败", err);
    return undefined;
  }
}

// 别的用户（含别的设备）已经识别过的歌词，或「五个渠道都查过确实没有」的标记。查不到只记日志、照常自己匹配
async function fetchRecognized(bvid: string | undefined, cid: string) {
  if (!bvid) return undefined;
  try {
    return await getRecognizedLyrics(bvid, cid);
  } catch (err) {
    log.warn("[lyrics] 查询已识别的歌词失败", err);
    return undefined;
  }
}

// 只有登录用户写得进去；失败不重试，下一首歌再说
async function reportRecognized(body: Parameters<typeof putRecognizedLyrics>[0]) {
  try {
    await putRecognizedLyrics(body);
  } catch (err) {
    log.warn("[lyrics] 上报识别结果失败", err);
  }
}

/**
 * Headless component — always mounted in the layout.
 * Owns lyrics loading (writes to useLyricsState) and broadcasts to the
 * desktop lyrics window, regardless of whether the lyrics panel is open.
 */
const LyricsBroadcaster = () => {
  const playId = usePlayList(s => s.playId);
  // 从搜索结果等入口点播时，歌曲先以无 cid 的状态切进来，cid 要等取播放地址时才补上（同一个 playId）。
  // 只跟 playId 的话，切歌那一刻没 cid 就放弃了、之后不会再读，整首歌既不查生效版本也不自动匹配
  const playCid = usePlayList(s => s.list.find(item => item.id === s.playId)?.cid);
  const isPlaying = usePlayList(s => s.isPlaying);
  // 只用来在进度变化时重新渲染，好让 lineElapsedMs 等派生值跟上；切行本身按帧走 useActiveLyricIndex
  usePlayProgress(s => s.currentTime);
  // 试听中的对齐结果也推给桌面歌词，用户能在桌面歌词上一起看效果
  const { lyrics, offset } = useDisplayedLyrics();

  const bc = useMemo(() => new BroadcastChannel(DESKTOP_LYRICS_CHANNEL), []);

  useEffect(() => () => bc.close(), [bc]);

  // Load lyrics whenever the track changes
  useEffect(() => {
    let canceled = false;
    const { setLyrics, setOffset, setIsLoading, setScreenOrigin, reset } = useLyricsState.getState();

    reset();

    const playItem = usePlayList.getState().getPlayItem();
    if (!playItem) return;

    const isLocal = playItem.source === "local";

    if (!isLocal) {
      if (!playItem.cid) return;
      const cidAsNumber = Number(playItem.cid);
      if (Number.isNaN(cidAsNumber)) return;
    }

    setIsLoading(true);

    const load = async () => {
      try {
        const cacheKey = isLocal ? `local-${playItem.id}` : `${playItem.bvid}-${playItem.cid}`;
        const store = await platform.getStore(StoreNameMap.LyricsCache);
        if (canceled) return;
        let staleAuto = false;
        const cached = store && typeof store === "object" ? store[cacheKey] : undefined;
        if (cached) {
          setOffset(typeof cached.offset === "number" ? cached.offset : DEFAULT_OFFSET);
          setScreenOrigin(cached.screenOrigin ?? null);
          if (cached.alignment) {
            setLyrics(alignmentToLines(cached.alignment.lines), parseLrc(cached.tLyrics));
          } else if (cached.lyrics || cached.tLyrics) {
            setLyrics(linesOfEntry(cached), parseLrc(cached.tLyrics));
          }
        }

        // 生效版本对所有人生效，优先于自动匹配；用户自己选的（手动采用 / 自己歌词的对齐结果）不覆盖
        let entry = cached;
        if (!isLocal) {
          const published = await fetchPublished(playItem.bvid, String(playItem.cid));
          if (canceled) return;
          // 管理员上次重跑、还没发布的结果：切歌回来接着试听，不用重新对齐
          void useLyricsAlignSession.getState().restoreDraft();
          if (published && !isUserChosen(entry)) {
            if (entry?.source === "approved" && entry.alignment?.lyricsHash === published.lyricsHash) return;
            const latest = (await platform.getStore(StoreNameMap.LyricsCache))?.[cacheKey];
            if (canceled || isUserChosen(latest)) return;
            const { lines, tLines } = await adoptAlignment(cacheKey, published, "approved");
            if (canceled) return;
            setLyrics(lines, tLines);
            setOffset(0);
            setScreenOrigin(latest?.screenOrigin ?? null);
            return;
          }
          // 本地还挂着生效版本，服务器上却没了：被管理员确认有误下线了，退回对齐前的歌词
          if (published === null && entry?.source === "approved" && entry.alignment) {
            const restored = await restorePreAlign(cacheKey, { byUser: false });
            if (canceled) return;
            if (restored) {
              entry = restored.entry;
              setLyrics(restored.lines, restored.tLines);
              setOffset(restored.offset);
            }
          }
          // 有歌词、还没逐字时间：自动对齐。包括用户手动选的歌词；点过「还原」的不再自动对齐
          if (entry && !entry.alignment && !entry.noAutoAlign && entry.lyrics) {
            useLyricsAlignSession.getState().auto(alignInputOf(entry), { userChosen: isUserChosen(entry) });
          }
        }

        if (entry && (entry.lyrics || entry.tLyrics)) {
          // 仅「自动匹配且算法已升级」的缓存才重新匹配；手动选择的永远保留
          staleAuto = entry.source === "auto" && (entry.autoVersion ?? 0) < AUTO_MATCH_VERSION;
          if (!staleAuto) return;
        }

        if (canceled) return;
        if (!staleAuto) setLyrics([]);

        // 成功靠缓存复用，只记正常完成的空结果；取消也算已尝试的话，切回来会整首没歌词
        if (autoMissed.has(cacheKey)) return;
        // 防抖：快速连切歌时，停留不足该时长的歌不发起任何请求（effect 清理会置 canceled）
        // eslint-disable-next-line @eslint-react/web-api/no-leaked-timeout -- 取消由 canceled 标志处理
        await new Promise(resolve => setTimeout(resolve, AUTO_MATCH_DEBOUNCE_MS));
        if (canceled) return;
        const bvid = playItem.bvid;
        const title = playItem.pageTitle || playItem.title;
        const tianci = !isLocal && looksLikeTianci(title);
        // 缓存里是旧算法按标题配上的歌词，填词歌多半是原曲的，识别期间不显示
        if (tianci && staleAuto) setLyrics([]);
        const shared = isLocal ? undefined : await fetchRecognized(bvid, String(playItem.cid));
        if (canceled) return;
        // 版本低于当前算法的服务端结果不用，自己重新匹配后会覆盖它
        const fresh = (shared?.v ?? 0) >= AUTO_MATCH_VERSION;
        let hit: Omit<AutoLyricsResult, "from"> | null = null;
        let from: AutoLyricsResult["from"] | undefined;
        let screenOrigin: ScreenOrigin | undefined;
        let fromServer = false;
        if (shared?.recognized && fresh) {
          const rec = shared.recognized;
          hit = { lyrics: rec.lyrics, tLyrics: rec.tLyrics ?? undefined };
          if (rec.from === "screen" || rec.from === "subtitle") {
            const kind = rec.from === "subtitle" ? "subtitle" : rec.confident ? "screen" : "screen-unsure";
            screenOrigin = screenOriginOf(kind, rec.lyrics);
          }
          fromServer = true;
        } else if (shared?.missingUntil && fresh) {
          if (!staleAuto) autoMissed.add(cacheKey);
          return;
        } else {
          const outcome: AutoMatchOutcome = { exhausted: false };
          const matched = tianci ? null : await autoMatchLyrics(title, playItem.duration, () => canceled, outcome);
          if (canceled) return;
          hit = matched;
          from = matched?.from;
          // 手机端的网易云 / LrcLib 还是空实现，「没查到」不能代表别的平台也没有
          if (!tianci && !hit && outcome.exhausted && !staleAuto && !isLocal && bvid && !isNativeMobile) {
            void reportRecognized({ bvid, cid: String(playItem.cid), v: AUTO_MATCH_VERSION, missing: true });
          }
          // 只有填词歌才识别画面：普通视频按标题搜不到就是暂无歌词，画面上的说话字幕（采访、小剧场）
          // 和歌词长得一样，识别了只会给人看假歌词。识别任务自己会在服务端记「查无歌词」
          if (!hit && !isLocal && bvid && tianci) {
            const screen = await recognizeFromScreen(bvid, String(playItem.cid), AUTO_MATCH_VERSION, () => canceled);
            if (canceled) return;
            if (screen) {
              hit = { lyrics: screen.lyrics, tLyrics: screen.tLyrics };
              screenOrigin = screenOriginOf(screen.kind, screen.lyrics);
              fromServer = true;
            }
          }
        }
        if (!hit) {
          autoMissed.add(cacheKey);
          return;
        }
        const latest = (await platform.getStore(StoreNameMap.LyricsCache)) ?? {};
        // 匹配期间用户可能已手动采用歌词，自动结果不得覆盖
        const now = latest[cacheKey];
        if (canceled || (now?.source !== "auto" && (now?.lyrics || now?.tLyrics))) return;
        // 来源信息随歌词一起换：网易云 / LrcLib 命中要清掉上一份歌词遗留的平台来源与逐字时间
        const entryOfHit = {
          ...(latest[cacheKey] || {}),
          lyrics: hit.lyrics,
          tLyrics: hit.tLyrics,
          source: "auto" as const,
          autoVersion: AUTO_MATCH_VERSION,
          origin: hit.origin,
          nativeTiming: hit.nativeTiming,
          screenOrigin,
        };
        setLyrics(linesOfEntry(entryOfHit), parseLrc(hit.tLyrics));
        setScreenOrigin(screenOrigin ?? null);
        await platform.setStore(StoreNameMap.LyricsCache, { ...latest, [cacheKey]: entryOfHit });
        if (!fromServer && !isLocal && bvid && from) {
          void reportRecognized({
            bvid,
            cid: String(playItem.cid),
            v: AUTO_MATCH_VERSION,
            lyrics: hit.lyrics,
            tLyrics: hit.tLyrics,
            from,
          });
        }
        if (!canceled && !isLocal && hit.lyrics) {
          useLyricsAlignSession.getState().auto(hit.lyrics, { userChosen: false });
        }
      } catch (err) {
        log.warn("[lyrics] 加载歌词出错", err);
        if (!canceled) setLyrics([]);
      } finally {
        if (!canceled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      canceled = true;
    };
  }, [playId, playCid]);

  const activeIndex = useActiveLyricIndex(lyrics, offset);
  const lastSyncRef = useRef({ elapsed: 0, at: 0, playing: false });

  const post = useCallback(() => {
    const line = lyrics[activeIndex];
    const lineElapsedMs = line ? Math.max(0, readPlaybackMs() + offset - line.time) : 0;
    lastSyncRef.current = { elapsed: lineElapsedMs, at: performance.now(), playing: isPlaying };
    bc.postMessage({ type: "update", lines: lyrics, activeIndex, lineElapsedMs, isPlaying });
  }, [bc, lyrics, activeIndex, offset, isPlaying]);

  // 切行、播放 / 暂停、换歌词时推一次完整快照
  useEffect(post, [post]);

  // 每次进度更新（约 250 ms）核一次外推误差，只在跳过去的时候补发，平时不刷屏
  useEffect(() => {
    const line = lyrics[activeIndex];
    if (!line) return;
    const { elapsed, at, playing } = lastSyncRef.current;
    const expected = elapsed + (playing ? performance.now() - at : 0);
    const actual = readPlaybackMs() + offset - line.time;
    if (Math.abs(expected - actual) > RESYNC_DRIFT_MS) post();
  });

  // Handle messages from desktop lyrics window
  useEffect(() => {
    const handleMessage = (ev: MessageEvent<{ type?: string; cmd?: string }>) => {
      const { type, cmd } = ev.data ?? {};
      // Respond to handshake requests with the full current snapshot,
      // including the fresh elapsed ms (re-read to avoid stale closure value).
      if (type === "request") {
        post();
        return;
      }
      // Handle player control commands from the desktop lyrics toolbar
      if (type === "cmd") {
        const store = usePlayList.getState();
        if (cmd === "toggle") store.togglePlay();
        if (cmd === "next") void store.next();
        if (cmd === "prev") void store.prev();
      }
    };
    bc.addEventListener("message", handleMessage);
    return () => bc.removeEventListener("message", handleMessage);
  }, [bc, post]);

  return null;
};

export default LyricsBroadcaster;
