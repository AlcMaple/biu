import { useEffect, useMemo } from "react";

import { adoptAlignment, alignmentToLines, isUserChosen } from "@/components/lyrics/alignment";
import { AUTO_MATCH_VERSION, autoMatchLyrics } from "@/components/lyrics/auto-match";
import { parseLrc } from "@/components/lyrics/parse-lrc";
import { readPlaybackMs, useActiveLyricIndex } from "@/components/lyrics/playback-clock";
import { DESKTOP_LYRICS_CHANNEL } from "@/pages/desktop-lyrics";
import platform, { log } from "@/platform";
import { getApprovedLyrics } from "@/service/lyrics-align";
import { useLyricsState } from "@/store/lyrics-state";
import { usePlayList } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";
import { StoreNameMap } from "@shared/store";

// Fallback duration used for the last lyric line (or any line missing a
// successor) so the karaoke progress has something finite to animate over.
const TAIL_LINE_DURATION_MS = 5000;

const DEFAULT_OFFSET = 0;

/** 切歌后等待多久才开始自动匹配歌词 */
const AUTO_MATCH_DEBOUNCE_MS = 1500;

const autoTried = new Set<string>();

// 查不到不影响播放：记日志后照常走本地缓存 / 自动匹配。每次打开都查，审核通过的新版本才能及时生效
async function fetchApproved(bvid: string | undefined, cid: string) {
  if (!bvid) return null;
  try {
    return (await getApprovedLyrics(bvid, cid)).alignment;
  } catch (err) {
    log.warn("[lyrics] 查询审核通过的歌词失败", err);
    return null;
  }
}

/**
 * Headless component — always mounted in the layout.
 * Owns lyrics loading (writes to useLyricsState) and broadcasts to the
 * desktop lyrics window, regardless of whether the lyrics panel is open.
 */
const LyricsBroadcaster = () => {
  const playId = usePlayList(s => s.playId);
  const isPlaying = usePlayList(s => s.isPlaying);
  // 只用来在进度变化时重新渲染，好让 lineElapsedMs 等派生值跟上；切行本身按帧走 useActiveLyricIndex
  usePlayProgress(s => s.currentTime);
  const lyrics = useLyricsState(s => s.lyrics);
  const offset = useLyricsState(s => s.offset);

  const bc = useMemo(() => new BroadcastChannel(DESKTOP_LYRICS_CHANNEL), []);

  useEffect(() => () => bc.close(), [bc]);

  // Load lyrics whenever the track changes
  useEffect(() => {
    let canceled = false;
    const { setLyrics, setOffset, setIsLoading, reset } = useLyricsState.getState();

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
          if (cached.alignment) {
            setLyrics(alignmentToLines(cached.alignment.lines), parseLrc(cached.tLyrics));
          } else if (cached.lyrics || cached.tLyrics) {
            setLyrics(parseLrc(cached.lyrics), parseLrc(cached.tLyrics));
          }
        }

        // 审核通过的歌词对所有人生效，优先于自动匹配；用户自己选的（手动采用 / 采用对齐结果）不覆盖
        if (!isLocal && !isUserChosen(cached)) {
          const approved = await fetchApproved(playItem.bvid, String(playItem.cid));
          if (canceled) return;
          if (approved) {
            if (cached?.source === "approved" && cached.alignment?.lyricsHash === approved.lyricsHash) return;
            const latest = (await platform.getStore(StoreNameMap.LyricsCache))?.[cacheKey];
            if (canceled || isUserChosen(latest)) return;
            const { lines, tLines } = await adoptAlignment(cacheKey, approved, "approved");
            if (!canceled) setLyrics(lines, tLines);
            return;
          }
        }

        if (cached && (cached.lyrics || cached.tLyrics)) {
          // 仅「自动匹配且算法已升级」的缓存才重新匹配；手动选择的永远保留
          staleAuto = cached.source === "auto" && (cached.autoVersion ?? 0) < AUTO_MATCH_VERSION;
          if (!staleAuto) return;
        }

        if (canceled) return;
        if (!staleAuto) setLyrics([]);

        // 无缓存：按标题 + 时长自动匹配歌词；每首歌每次会话只尝试一次，命中后写入缓存
        if (autoTried.has(cacheKey)) return;
        // 防抖：快速连切歌时，停留不足该时长的歌不发起任何请求（effect 清理会置 canceled）
        // eslint-disable-next-line @eslint-react/web-api/no-leaked-timeout -- 取消由 canceled 标志处理
        await new Promise(resolve => setTimeout(resolve, AUTO_MATCH_DEBOUNCE_MS));
        if (canceled) return;
        autoTried.add(cacheKey);
        const hit = await autoMatchLyrics(playItem.pageTitle || playItem.title, playItem.duration, () => canceled);
        if (canceled || !hit) return;
        const latest = (await platform.getStore(StoreNameMap.LyricsCache)) ?? {};
        // 匹配期间用户可能已手动采用歌词，自动结果不得覆盖
        const now = latest[cacheKey];
        if (canceled || (now?.source !== "auto" && (now?.lyrics || now?.tLyrics))) return;
        setLyrics(parseLrc(hit.lyrics), parseLrc(hit.tLyrics));
        await platform.setStore(StoreNameMap.LyricsCache, {
          ...latest,
          [cacheKey]: {
            ...(latest[cacheKey] || {}),
            lyrics: hit.lyrics,
            tLyrics: hit.tLyrics,
            source: "auto",
            autoVersion: AUTO_MATCH_VERSION,
          },
        });
      } catch {
        if (!canceled) setLyrics([]);
      } finally {
        if (!canceled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      canceled = true;
    };
  }, [playId]);

  const activeIndex = useActiveLyricIndex(lyrics, offset);
  const currentMs = readPlaybackMs() + offset;

  // Duration of the active lyric line — gap to the next line, or a tail
  // fallback for the last line. Used by the desktop window to drive its
  // karaoke progress animation.
  const lineDurationMs = (() => {
    if (activeIndex < 0 || activeIndex >= lyrics.length) return 0;
    const nextLyric = lyrics[activeIndex + 1];
    if (nextLyric) return Math.max(0, nextLyric.time - lyrics[activeIndex].time);
    return TAIL_LINE_DURATION_MS;
  })();
  const lineElapsedMs = activeIndex >= 0 && lyrics[activeIndex] ? Math.max(0, currentMs - lyrics[activeIndex].time) : 0;

  // Broadcast whenever the active line, play state, or loaded lyrics change.
  // lineElapsedMs piggybacks on each broadcast (it's accurate at broadcast
  // time; between broadcasts the window extrapolates via CSS transitions).
  useEffect(() => {
    bc.postMessage({
      type: "update",
      lines: lyrics,
      activeIndex,
      lineDurationMs,
      lineElapsedMs,
      isPlaying,
    });
    // lineElapsedMs intentionally omitted: updating it every progress tick
    // would flood the channel. Captured at the moment the line/isPlaying
    // changes, which is when the window needs a fresh snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bc, lyrics, activeIndex, lineDurationMs, isPlaying]);

  // Handle messages from desktop lyrics window
  useEffect(() => {
    const handleMessage = (ev: MessageEvent<{ type?: string; cmd?: string }>) => {
      const { type, cmd } = ev.data ?? {};
      // Respond to handshake requests with the full current snapshot,
      // including the fresh elapsed ms (re-read to avoid stale closure value).
      if (type === "request") {
        const freshElapsed =
          activeIndex >= 0 && lyrics[activeIndex]
            ? Math.max(0, readPlaybackMs() + offset - lyrics[activeIndex].time)
            : 0;
        bc.postMessage({
          type: "update",
          lines: lyrics,
          activeIndex,
          lineDurationMs,
          lineElapsedMs: freshElapsed,
          isPlaying,
        });
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
  }, [bc, lyrics, activeIndex, lineDurationMs, offset, isPlaying]);

  return null;
};

export default LyricsBroadcaster;
