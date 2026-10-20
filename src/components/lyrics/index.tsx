import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Popover, PopoverContent, PopoverTrigger, addToast, useDisclosure } from "@heroui/react";
import { RiTBoxLine, RiTimerFlashLine } from "@remixicon/react";
import clsx from "classnames";
import { debounce } from "es-toolkit";

import { lyricsCacheKey, restorePreAlign } from "@/components/lyrics/alignment";
import { parseLrc } from "@/components/lyrics/parse-lrc";
import platform from "@/platform";
import { useLyricsAlignSession } from "@/store/lyrics-align-session";
import { type LyricLine, useDisplayedLyrics, useLyricsState } from "@/store/lyrics-state";
import { usePlayList } from "@/store/play-list";
import { StoreNameMap } from "@shared/store";

import IconButton from "../icon-button";
import LyricsAlignModal from "../lyrics-align-modal";
import LyricsSearchModal from "../lyrics-search-modal";
import AlignBar from "./align-bar";
import FontSizeControl from "./font-size-control";
import { karaokeTiming } from "./karaoke";
import KaraokeText from "./karaoke-text";
import OffsetControl from "./offset-control";
import { subscribePlaybackClock, useActiveLyricIndex } from "./playback-clock";

type PlayItem = ReturnType<ReturnType<typeof usePlayList.getState>["getPlayItem"]>;

const activeTextBase = "text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.35)]";

const DEFAULT_FONT_SIZE = 20;

const ALIGN_MENU = [
  { key: "align", label: "对齐当前歌词", description: "按这首歌的 B 站音频校准每个字的时间，约 2 分钟" },
  { key: "edit", label: "换一份歌词再对齐", description: "粘贴或修改歌词后再对齐" },
  { key: "restore", label: "还原为对齐前的歌词", description: "回到第一次对齐之前的歌词和偏移" },
];

const Lyrics = ({
  color,
  centered,
  showControls,
  stableTypography = false,
  onControlsOpenChange,
}: {
  color?: string;
  centered?: boolean;
  showControls?: boolean;
  stableTypography?: boolean;
  // 字号 / 偏移 / 对齐的浮层渲染在播放器外层，鼠标移上去会被播放器当成离开而 3 秒后收起控件；打开时通知播放器别收
  onControlsOpenChange?: (open: boolean) => void;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [centerPadding, setCenterPadding] = useState(0);
  const playId = usePlayList(s => s.playId);
  const canAlign = usePlayList(s => {
    const item = s.list.find(i => i.id === s.playId);
    return Boolean(item && item.source !== "local" && item.bvid && item.cid);
  });
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);

  // Read lyrics state from shared store (owned by LyricsBroadcaster)
  const { lyrics, translatedLyrics, offset } = useDisplayedLyrics();
  const isLoading = useLyricsState(s => s.isLoading);

  // Reset fontSize when track changes
  useEffect(() => {
    setFontSize(DEFAULT_FONT_SIZE);
  }, [playId]);

  // Restore fontSize from cache when track changes
  useEffect(() => {
    let canceled = false;
    const playItem = usePlayList.getState().getPlayItem();
    const cacheKey =
      playItem?.source === "local"
        ? `local-${playItem.id}`
        : playItem?.bvid && playItem?.cid
          ? `${playItem.bvid}-${playItem.cid}`
          : null;
    if (!cacheKey) return;
    platform.getStore(StoreNameMap.LyricsCache).then(store => {
      if (canceled || !store || typeof store !== "object") return;
      const cached = store[cacheKey];
      if (cached && typeof cached.fontSize === "number") {
        setFontSize(cached.fontSize);
      }
    });
    return () => {
      canceled = true;
    };
  }, [playId]);

  const {
    isOpen: isSearchOpen,
    onOpen: onOpenSearch,
    onClose: onCloseSearch,
    onOpenChange: setIsSearchOpen,
  } = useDisclosure();

  const translationMap = useMemo(() => {
    if (!translatedLyrics?.length) return new Map<number, string>();
    const map = new Map<number, string>();
    translatedLyrics.forEach(item => map.set(item.time, item.text));
    return map;
  }, [translatedLyrics]);

  const activeIndex = useActiveLyricIndex(lyrics, offset);

  const activeTiming = useMemo(
    () =>
      activeIndex >= 0 && lyrics[activeIndex]
        ? karaokeTiming(lyrics[activeIndex], lyrics[activeIndex + 1]?.time)
        : null,
    [lyrics, activeIndex],
  );
  const subscribeClock = useCallback(
    (onTick: (ms: number) => void) => subscribePlaybackClock(ms => onTick(ms + offset)),
    [offset],
  );

  const persistLyricsCache = useMemo(
    () =>
      debounce(async (playItem: PlayItem, nextOffset?: number, nextFontSize?: number) => {
        try {
          const key =
            playItem?.source === "local"
              ? `local-${playItem?.id}`
              : playItem?.bvid && playItem?.cid
                ? `${playItem.bvid}-${playItem.cid}`
                : null;
          if (!key) return;
          const store = await platform.getStore(StoreNameMap.LyricsCache);
          const prev = store?.[key] || {};

          await platform.setStore(StoreNameMap.LyricsCache, {
            ...(store || {}),
            [key]: {
              ...prev,
              offset: nextOffset ?? 0,
              fontSize: nextFontSize ?? 0,
            },
          });
        } catch {
          addToast({ color: "danger", title: "保存失败" });
        }
      }, 500),
    [],
  );

  const handleOffsetChange = useCallback(
    (next: number) => {
      useLyricsState.getState().setOffset(next);

      const playItem = usePlayList.getState().getPlayItem();
      const hasCacheKey = playItem?.source === "local" ? !!playItem.id : !!(playItem?.bvid && playItem?.cid);
      if (!hasCacheKey) return;

      persistLyricsCache(playItem, next, fontSize);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontSize, persistLyricsCache, playId],
  );

  const handleFontSizeChange = useCallback(
    (next: number) => {
      setFontSize(next);

      const playItem = usePlayList.getState().getPlayItem();
      const hasCacheKey = playItem?.source === "local" ? !!playItem.id : !!(playItem?.bvid && playItem?.cid);
      if (!hasCacheKey) return;

      persistLyricsCache(playItem, offset, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offset, persistLyricsCache, playId],
  );

  const updateCenterPadding = useCallback(() => {
    if (activeIndex < 0) {
      setCenterPadding(0);
      return;
    }

    const measure = () => {
      const containerHeight = containerRef.current?.clientHeight ?? 0;
      const lineHeight = lineRefs.current[activeIndex]?.clientHeight ?? 0;
      if (containerHeight > 0 && lineHeight > 0) {
        const padding = Math.max(0, containerHeight / 2 - lineHeight / 2);
        setCenterPadding(padding);
        return true;
      }
      return false;
    };

    if (!measure()) {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        void measure();
      });
    }
  }, [activeIndex]);

  const [editorInput, setEditorInput] = useState<string | null>(null);
  const [canRestore, setCanRestore] = useState(false);
  const [alignMenuOpen, setAlignMenuOpen] = useState(false);

  // 控件随播放器自动收起时浮层跟着卸载，开着的状态要一起清掉，否则再显示时第一下点击只是把它“关上”
  useEffect(() => {
    if (!showControls) setAlignMenuOpen(false);
  }, [showControls]);

  const handleLyricsAdopted = useCallback(
    (nextLyrics?: string, nextTLyrics?: string, alsoAlign?: boolean) => {
      onCloseSearch();
      if (nextLyrics) {
        useLyricsState.getState().setLyrics(parseLrc(nextLyrics), nextTLyrics ? parseLrc(nextTLyrics) : []);
        if (alsoAlign) void useLyricsAlignSession.getState().start(nextLyrics, { skipApproved: true });
      }
    },
    [onCloseSearch],
  );

  const readCacheEntry = useCallback(async () => {
    const key = lyricsCacheKey(usePlayList.getState().getPlayItem());
    return { key, entry: key ? (await platform.getStore(StoreNameMap.LyricsCache))?.[key] : undefined };
  }, []);

  // 已经对齐过时用对齐前的原歌词：原歌词的时间用来给对齐失败的行划重对齐窗口，比拿对齐结果再对一遍可靠
  const alignInputOf = (entry?: MusicLyrics) => (entry?.alignment && entry.preAlign?.lyrics) || entry?.lyrics || "";

  const handleAlignAction = useCallback(
    async (action: string) => {
      const { key, entry } = await readCacheEntry();
      if (action === "edit") {
        setEditorInput(alignInputOf(entry));
        return;
      }
      if (action === "restore" && key) {
        const restored = await restorePreAlign(key);
        if (!restored) return;
        const state = useLyricsState.getState();
        state.setLyrics(restored.lines, restored.tLines);
        state.setOffset(restored.offset);
        addToast({ title: "已还原为对齐前的歌词", color: "success" });
        return;
      }
      const input = alignInputOf(entry);
      if (!input.trim()) {
        addToast({ title: "这首歌还没有歌词，先在「搜索歌词」里找一份", color: "warning" });
        return;
      }
      void useLyricsAlignSession.getState().start(input);
    },
    [readCacheEntry],
  );

  useEffect(() => {
    return () => {
      const cancelable = persistLyricsCache as { cancel?: () => void };
      cancelable.cancel?.();
    };
  }, [persistLyricsCache]);

  useEffect(() => {
    updateCenterPadding();
  }, [updateCenterPadding, fontSize, lyrics.length]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [activeIndex]);

  useEffect(() => {
    const handleResize = () => updateCenterPadding();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateCenterPadding]);

  useEffect(() => {
    const wrapper = containerRef.current;
    if (activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    if (el && wrapper) {
      const top = el.offsetTop - wrapper.clientHeight / 2 + el.clientHeight / 2;
      const reduceMotion = stableTypography && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      wrapper.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? "auto" : "smooth" });
    }
  }, [activeIndex, centerPadding, stableTypography]);

  const renderLine = (line: LyricLine, index: number) => {
    const isActive = index === activeIndex;
    const translation = translationMap.get(line.time);
    const activeWeight = stableTypography ? "font-medium" : isActive ? "font-extrabold" : "font-normal";
    const activeShadow = isActive ? activeTextBase : "";

    return (
      <div
        key={`${line.time}-${index}`}
        aria-current={isActive ? "true" : undefined}
        data-lyric-state={isActive ? "active" : index < activeIndex ? "past" : "upcoming"}
        ref={node => {
          lineRefs.current[index] = node;
        }}
        className={clsx(
          "w-full transform-none py-2 duration-300 ease-out",
          stableTypography ? "transition-opacity" : "transition-all",
          stableTypography && "fancy-lyric-line",
          centered ? "text-center" : "text-left",
          stableTypography || isActive ? "opacity-100" : "opacity-60",
        )}
        style={{
          fontSize: isActive && !stableTypography ? fontSize * 1.5 : fontSize,
          transform: "none",
          overflowWrap: stableTypography ? "anywhere" : undefined,
        }}
      >
        <div
          className={clsx(
            "leading-snug break-words whitespace-pre-wrap",
            activeWeight,
            !stableTypography && activeShadow,
          )}
          style={{
            color: stableTypography ? undefined : color || undefined,
            overflowWrap: stableTypography ? "anywhere" : undefined,
          }}
        >
          {isActive && activeTiming?.words.length ? (
            <KaraokeText timing={activeTiming} subscribe={subscribeClock} baseClassName="opacity-45" />
          ) : (
            line.text
          )}
        </div>
        {translation ? (
          <div
            className="mt-1 text-sm break-words whitespace-pre-wrap text-white/80"
            style={{ overflowWrap: stableTypography ? "anywhere" : undefined }}
          >
            {translation}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <div className="group/lyrics relative flex h-full w-full items-center justify-center overflow-hidden">
        <AlignBar onEditLyrics={() => void handleAlignAction("edit")} />
        <div
          ref={containerRef}
          className="no-scrollbar relative h-full w-full max-w-4xl overflow-y-auto"
          style={{
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.15) 6%, rgba(0,0,0,0.5) 12%, black 24%, black 76%, rgba(0,0,0,0.5) 88%, rgba(0,0,0,0.15) 94%, transparent 100%)",
            maskImage:
              "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.15) 6%, rgba(0,0,0,0.5) 12%, black 24%, black 76%, rgba(0,0,0,0.5) 88%, rgba(0,0,0,0.15) 94%, transparent 100%)",
          }}
        >
          {lyrics.length ? (
            <div
              className={clsx("space-y-2", stableTypography && "pr-16")}
              style={{
                paddingTop: centerPadding,
                paddingBottom: centerPadding,
              }}
            >
              {lyrics.map((line, index) => renderLine(line, index))}
            </div>
          ) : (
            <div className="text-foreground/70 flex h-full items-center justify-center">
              {isLoading ? "歌词加载中..." : "暂无歌词"}
            </div>
          )}
        </div>

        {showControls && (
          <div className="text-foreground/80 pointer-events-none absolute right-6 bottom-6 flex flex-col items-center space-y-3 text-sm transition-opacity duration-200">
            <div className="pointer-events-auto">
              <FontSizeControl value={fontSize} onChange={handleFontSizeChange} onOpenChange={onControlsOpenChange} />
            </div>
            <div className="pointer-events-auto">
              <OffsetControl value={offset} onChange={handleOffsetChange} onOpenChange={onControlsOpenChange} />
            </div>
            {canAlign ? (
              <div className="pointer-events-auto">
                {/* 全屏播放器是抽屉，会把焦点拉回自己身上；失焦即关的话浮层一打开就被关掉（字号 / 偏移控件同样关了这一项） */}
                <Popover
                  placement="left"
                  showArrow={false}
                  shouldCloseOnBlur={false}
                  disableAnimation
                  offset={8}
                  isOpen={alignMenuOpen && Boolean(showControls)}
                  onOpenChange={open => {
                    setAlignMenuOpen(open);
                    onControlsOpenChange?.(open);
                    if (open)
                      void readCacheEntry().then(({ entry }) =>
                        setCanRestore(Boolean(entry?.alignment && entry.preAlign)),
                      );
                  }}
                >
                  <PopoverTrigger>
                    <IconButton
                      type="button"
                      aria-label="逐字对齐"
                      className="bg-foreground/20 text-foreground hover:bg-foreground/30 min-w-0 rounded-full text-xs font-semibold"
                    >
                      <RiTimerFlashLine size={16} />
                    </IconButton>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-1">
                    <div className="flex w-full flex-col">
                      {ALIGN_MENU.filter(item => item.key !== "restore" || canRestore).map(item => (
                        <Button
                          key={item.key}
                          variant="light"
                          className="h-auto flex-col items-start gap-0.5 px-3 py-2 text-left"
                          onPress={() => {
                            setAlignMenuOpen(false);
                            onControlsOpenChange?.(false);
                            void handleAlignAction(item.key);
                          }}
                        >
                          <span className="text-sm">{item.label}</span>
                          <span className="text-foreground-500 text-xs font-normal whitespace-normal">
                            {item.description}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            ) : null}
            <div className="pointer-events-auto">
              <IconButton
                type="button"
                onPress={onOpenSearch}
                className="bg-foreground/20 text-foreground hover:bg-foreground/30 min-w-0 rounded-full text-xs font-semibold"
              >
                <RiTBoxLine size={16} />
              </IconButton>
            </div>
          </div>
        )}
      </div>
      <LyricsSearchModal isOpen={isSearchOpen} onOpenChange={setIsSearchOpen} onLyricsAdopted={handleLyricsAdopted} />
      <LyricsAlignModal
        isOpen={editorInput !== null}
        onOpenChange={open => !open && setEditorInput(null)}
        initialLyrics={editorInput ?? ""}
      />
    </>
  );
};

export default Lyrics;
