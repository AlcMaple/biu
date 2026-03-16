import { useEffect, useMemo } from "react";

import type { WebPlayerParams } from "@/service/web-player";

import { getLyricsByBili } from "@/components/lyrics/get-lyrics";
import { parseLrc } from "@/components/lyrics/parse-lrc";
import { DESKTOP_LYRICS_CHANNEL } from "@/pages/desktop-lyrics";
import { useLyricsState } from "@/store/lyrics-state";
import { usePlayList } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";
import { StoreNameMap } from "@shared/store";

const DEFAULT_OFFSET = 0;

/**
 * Headless component — always mounted in the layout.
 * Owns lyrics loading (writes to useLyricsState) and broadcasts to the
 * desktop lyrics window, regardless of whether the lyrics panel is open.
 */
const LyricsBroadcaster = () => {
  const playId = usePlayList(s => s.playId);
  const { currentTime } = usePlayProgress();
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
    if (!playItem?.cid) return;

    const cidAsNumber = Number(playItem.cid);
    if (Number.isNaN(cidAsNumber)) return;

    setIsLoading(true);

    const load = async () => {
      try {
        // Check cache first
        if (playItem.bvid) {
          const store = await window.electron.getStore(StoreNameMap.LyricsCache);
          if (canceled) return;
          if (store && typeof store === "object") {
            const cached = store[`${playItem.bvid}-${playItem.cid}`];
            if (cached) {
              setOffset(typeof cached.offset === "number" ? cached.offset : DEFAULT_OFFSET);
              if (cached.lyrics || cached.tLyrics) {
                setLyrics(parseLrc(cached.lyrics), parseLrc(cached.tLyrics));
                return;
              }
            }
          }
        }

        const params: WebPlayerParams = { cid: cidAsNumber };
        if (playItem.bvid) params.bvid = playItem.bvid;
        const aidAsNumber = playItem.aid ? Number(playItem.aid) : undefined;
        if (aidAsNumber && !Number.isNaN(aidAsNumber)) params.aid = aidAsNumber;

        const body = await getLyricsByBili(params);
        if (!canceled) setLyrics(body ?? []);
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

  // Compute active line
  const currentMs = currentTime * 1000 + offset;
  const activeIndex = (() => {
    if (!lyrics.length) return -1;
    for (let i = lyrics.length - 1; i >= 0; i -= 1) {
      if (currentMs >= lyrics[i].time) return i;
    }
    return 0;
  })();

  const line = activeIndex >= 0 ? (lyrics[activeIndex]?.text ?? "") : "";
  const nextLine = activeIndex >= 0 ? (lyrics[activeIndex + 1]?.text ?? "") : "";

  useEffect(() => {
    bc.postMessage({ type: "update", line, nextLine });
  }, [bc, line, nextLine]);

  useEffect(() => {
    const handleRequest = (ev: MessageEvent<{ type?: string }>) => {
      if (ev.data?.type !== "request") return;
      bc.postMessage({ type: "update", line, nextLine });
    };
    bc.addEventListener("message", handleRequest);
    return () => bc.removeEventListener("message", handleRequest);
  }, [bc, line, nextLine]);

  return null;
};

export default LyricsBroadcaster;
