import { useEffect, useMemo } from "react";

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
  const isPlaying = usePlayList(s => s.isPlaying);
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
        const store = await window.electron.getStore(StoreNameMap.LyricsCache);
        if (canceled) return;
        if (store && typeof store === "object") {
          const cached = store[cacheKey];
          if (cached) {
            setOffset(typeof cached.offset === "number" ? cached.offset : DEFAULT_OFFSET);
            if (cached.lyrics || cached.tLyrics) {
              setLyrics(parseLrc(cached.lyrics), parseLrc(cached.tLyrics));
              return;
            }
          }
        }

        if (!canceled) setLyrics([]);
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

  // Broadcast current state whenever it changes
  useEffect(() => {
    bc.postMessage({ type: "update", line, nextLine, isPlaying });
  }, [bc, line, nextLine, isPlaying]);

  // Handle messages from desktop lyrics window
  useEffect(() => {
    const handleMessage = (ev: MessageEvent<{ type?: string; cmd?: string }>) => {
      const { type, cmd } = ev.data ?? {};
      // Respond to handshake requests
      if (type === "request") {
        bc.postMessage({ type: "update", line, nextLine, isPlaying });
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
  }, [bc, line, nextLine, isPlaying]);

  return null;
};

export default LyricsBroadcaster;
