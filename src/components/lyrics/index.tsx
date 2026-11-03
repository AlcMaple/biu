import { useCallback, use, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Switch,
  addToast,
  useDisclosure,
} from "@heroui/react";
import { RiEqualizerLine } from "@remixicon/react";
import clsx from "classnames";
import { debounce } from "es-toolkit";

import { lyricsCacheKey, restorePreAlign } from "@/components/lyrics/alignment";
import { parseLrc } from "@/components/lyrics/parse-lrc";
import platform, { isElectron } from "@/platform";
import { useAlignReview } from "@/store/align-review";
import { useFullScreenPlayerSettings } from "@/store/full-screen-player-settings";
import { alignInputOf, useLyricsAlignSession } from "@/store/lyrics-align-session";
import { type LyricLine, useDisplayedLyrics, useLyricsState } from "@/store/lyrics-state";
import { usePlayList } from "@/store/play-list";
import { StoreNameMap } from "@shared/store";

import LyricsAlignModal from "../lyrics-align-modal";
import ReportModal, { type ReportSubject } from "../lyrics-align-modal/report-modal";
import LyricsSearchModal from "../lyrics-search-modal";
import AlignChip from "./align-chip";
import { AlignChipSlotContext } from "./align-chip-slot";
import DesktopLyricsButton from "./desktop-lyrics-button";
import FontSizeControl from "./font-size-control";
import { karaokeTiming } from "./karaoke";
import KaraokeText from "./karaoke-text";
import OffsetControl from "./offset-control";
import { subscribePlaybackClock, useActiveLyricIndex } from "./playback-clock";

type PlayItem = ReturnType<ReturnType<typeof usePlayList.getState>["getPlayItem"]>;

const activeTextBase = "text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.35)]";

const DEFAULT_FONT_SIZE = 20;

// 高亮只做视觉放大：所有行都按「宽度 / 倍率」排版，高亮行 scale 后刚好撑满整宽。
// 若改字号 / 字重放大，高亮行会比平时多折一行，把整列歌词顶得上下跳动。
const ACTIVE_SCALE = 1.35;

// 歌词是全员共享的同一份：识别、对齐都在后台自动完成，普通用户不能自己换歌词，只能报错，由管理员统一更新。
// 换歌词、还原、手动重跑是管理员的维护手段，用来判断是算法错了还是歌词 / 音频的问题
type AlignAction = "report" | "restore" | "align" | "edit";

const ALIGN_MENU: { key: AlignAction; label: string; description: string; admin?: true }[] = [
  { key: "report", label: "歌词报错", description: "歌词、译文、罗马音等哪里不对，告诉管理员" },
  {
    key: "restore",
    label: "还原为对齐前的歌词",
    description: "回到逐字对齐之前的歌词和偏移，之后不再自动对齐",
    admin: true,
  },
  { key: "align", label: "重新对齐当前歌词", description: "插到队首、跳过缓存重跑，先试听再决定", admin: true },
  { key: "edit", label: "换一份歌词再对齐", description: "粘贴或修改歌词后插队对齐", admin: true },
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
  // 觉得歌词不对的人第一反应是来这里调快慢或报错，此时告诉他正在对齐，比在角落常驻提示更能被看到
  const aligningNote = useLyricsAlignSession(s => {
    const currentKey = lyricsCacheKey(usePlayList.getState().getPlayItem());
    if (s.phase.kind !== "working" || !s.target || s.target.cacheKey !== currentKey) return null;
    const position = s.phase.view?.state === "queued" ? s.phase.view.position : undefined;
    return position ? `排队对齐中，前面还有 ${position} 首` : "正在对齐，约 2 分钟后自动校准";
  });
  const canAlign = usePlayList(s => {
    const item = s.list.find(i => i.id === s.playId);
    return Boolean(item && item.source !== "local" && item.bvid && item.cid);
  });
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);

  // Read lyrics state from shared store (owned by LyricsBroadcaster)
  const { lyrics, translatedLyrics, romanizedLyrics, offset } = useDisplayedLyrics();
  const showTranslation = useFullScreenPlayerSettings(s => s.showTranslation);
  const showRomanization = useFullScreenPlayerSettings(s => s.showRomanization);
  const isLoading = useLyricsState(s => s.isLoading);
  const screenStatus = useLyricsState(s => s.screenStatus);

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

  const chipSlot = use(AlignChipSlotContext);

  const {
    isOpen: isSearchOpen,
    onOpen: onOpenSearch,
    onClose: onCloseSearch,
    onOpenChange: setIsSearchOpen,
  } = useDisclosure();

  const translationMap = useMemo(
    () => new Map((showTranslation ? translatedLyrics : []).map(item => [item.time, item.text])),
    [translatedLyrics, showTranslation],
  );
  const romanizationMap = useMemo(
    () => new Map((showRomanization ? romanizedLyrics : []).map(item => [item.time, item.text])),
    [romanizedLyrics, showRomanization],
  );

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

  const isAdmin = useAlignReview(s => s.isAdmin);
  const [editor, setEditor] = useState<string | null>(null);
  const [report, setReport] = useState<ReportSubject | null>(null);
  const [menuEntry, setMenuEntry] = useState<MusicLyrics | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const alignMenu = canAlign
    ? ALIGN_MENU.filter(
        item =>
          (!item.admin || isAdmin) &&
          (item.key !== "restore" || Boolean(menuEntry?.alignment && menuEntry.preAlign)) &&
          (item.key !== "report" || Boolean(menuEntry?.alignment)),
      )
    : [];

  // 控件随播放器自动收起时浮层跟着卸载，开着的状态要一起清掉，否则再显示时第一下点击只是把它“关上”
  useEffect(() => {
    if (!showControls) setSettingsOpen(false);
  }, [showControls]);

  const handleLyricsAdopted = useCallback(
    (nextLyrics?: string, nextTLyrics?: string, lines?: LyricLine[]) => {
      onCloseSearch();
      if (nextLyrics) {
        useLyricsState.getState().setLyrics(lines ?? parseLrc(nextLyrics), nextTLyrics ? parseLrc(nextTLyrics) : []);
        useLyricsAlignSession.getState().auto(nextLyrics, { userChosen: true, immediate: true });
      }
    },
    [onCloseSearch],
  );

  const readCacheEntry = useCallback(async () => {
    const key = lyricsCacheKey(usePlayList.getState().getPlayItem());
    return { key, entry: key ? (await platform.getStore(StoreNameMap.LyricsCache))?.[key] : undefined };
  }, []);

  // 面板开着时对齐完成，歌词会被换掉；跟着重读缓存，否则「歌词报错」要关掉重开才出现
  useEffect(() => {
    if (!settingsOpen || !canAlign) return;
    let canceled = false;
    void readCacheEntry().then(({ entry }) => !canceled && setMenuEntry(entry));
    return () => {
      canceled = true;
    };
  }, [settingsOpen, canAlign, readCacheEntry, lyrics]);

  const handleAlignAction = useCallback(
    async (action: AlignAction) => {
      const { key, entry } = await readCacheEntry();
      if (action === "edit") {
        setEditor(alignInputOf(entry));
        return;
      }
      if (action === "report") {
        setReport(entry?.alignment ?? null);
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
    const romanization = romanizationMap.get(line.time);
    const activeWeight = stableTypography ? "font-medium" : "font-semibold";
    const scaled = isActive && !stableTypography;
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
          "w-full py-3 duration-300 ease-out",
          stableTypography ? "transition-opacity" : "transition-all",
          stableTypography && "fancy-lyric-line",
          centered ? "text-center" : "text-left",
          stableTypography || isActive ? "opacity-100" : "opacity-60",
        )}
        style={{
          fontSize,
          overflowWrap: stableTypography ? "anywhere" : undefined,
        }}
      >
        <div
          className={clsx(
            "transition-transform duration-300 ease-out",
            centered ? "mx-auto origin-center" : "origin-left",
          )}
          style={{
            width: stableTypography ? undefined : `${100 / ACTIVE_SCALE}%`,
            transform: scaled ? `scale(${ACTIVE_SCALE})` : undefined,
          }}
        >
          {romanization ? (
            <div
              className="mb-1 text-sm break-words whitespace-pre-wrap text-white/60"
              style={{ overflowWrap: stableTypography ? "anywhere" : undefined }}
            >
              {romanization}
            </div>
          ) : null}
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
      </div>
    );
  };

  return (
    <>
      <div className="group/lyrics relative flex h-full w-full items-center justify-center overflow-hidden">
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
              {screenStatus?.kind === "working"
                ? "正在从视频画面识别歌词…"
                : screenStatus?.kind === "failed"
                  ? screenStatus.message
                  : isLoading
                    ? "歌词加载中..."
                    : "暂无歌词"}
            </div>
          )}
        </div>

        {showControls && (
          <div className="pointer-events-none absolute top-4 right-6 flex items-center gap-2 transition-opacity duration-200">
            {isElectron && (
              <div className="pointer-events-auto">
                <DesktopLyricsButton />
              </div>
            )}
            <div className="pointer-events-auto">
              {/* 全屏播放器是抽屉，会把焦点拉回自己身上；失焦即关的话浮层一打开就被关掉 */}
              <Popover
                placement="bottom-end"
                showArrow={false}
                shouldCloseOnBlur={false}
                disableAnimation
                offset={8}
                isOpen={settingsOpen && Boolean(showControls)}
                onOpenChange={open => {
                  setSettingsOpen(open);
                  onControlsOpenChange?.(open);
                }}
              >
                <PopoverTrigger>
                  <Button
                    size="sm"
                    radius="full"
                    variant="flat"
                    className="bg-foreground/20 text-foreground hover:bg-foreground/30 h-8 min-w-0 gap-1 px-3 text-sm whitespace-nowrap"
                  >
                    <RiEqualizerLine size={16} />
                    歌词设置
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-1">
                  <div className="flex w-full flex-col">
                    {aligningNote && (
                      <div className="bg-foreground/5 m-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm">
                        <Spinner size="sm" variant="simple" />
                        {aligningNote}
                      </div>
                    )}
                    <FontSizeControl value={fontSize} onChange={handleFontSizeChange} />
                    <OffsetControl value={offset} onChange={handleOffsetChange} />
                    {translatedLyrics.length > 0 && (
                      <div className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>显示译文</span>
                        <Switch
                          size="sm"
                          aria-label="显示译文"
                          isSelected={showTranslation}
                          onValueChange={v => useFullScreenPlayerSettings.getState().update({ showTranslation: v })}
                        />
                      </div>
                    )}
                    {romanizedLyrics.length > 0 && (
                      <div className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>显示罗马音</span>
                        <Switch
                          size="sm"
                          aria-label="显示罗马音"
                          isSelected={showRomanization}
                          onValueChange={v => useFullScreenPlayerSettings.getState().update({ showRomanization: v })}
                        />
                      </div>
                    )}
                    {(isAdmin || alignMenu.length > 0) && <div className="bg-divider my-1 h-px" />}
                    {isAdmin && (
                      <Button
                        variant="light"
                        className="h-auto flex-col items-start gap-0.5 px-3 py-2 text-left"
                        onPress={() => {
                          setSettingsOpen(false);
                          onControlsOpenChange?.(false);
                          onOpenSearch();
                        }}
                      >
                        <span className="text-sm">换一份歌词</span>
                        <span className="text-foreground-500 text-xs font-normal whitespace-normal">
                          从网易云、LrcLib、QQ、酷狗、AMLL 搜索并使用
                        </span>
                      </Button>
                    )}
                    {alignMenu.map(item => (
                      <Button
                        key={item.key}
                        variant="light"
                        className="h-auto flex-col items-start gap-0.5 px-3 py-2 text-left"
                        onPress={() => {
                          setSettingsOpen(false);
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
          </div>
        )}
      </div>
      {chipSlot
        ? createPortal(
            <AlignChip onSearchLyrics={isAdmin ? onOpenSearch : undefined} onOpenChange={onControlsOpenChange} />,
            chipSlot,
          )
        : null}
      {isAdmin && (
        <LyricsSearchModal isOpen={isSearchOpen} onOpenChange={setIsSearchOpen} onLyricsAdopted={handleLyricsAdopted} />
      )}
      <LyricsAlignModal
        isOpen={editor !== null}
        onOpenChange={open => !open && setEditor(null)}
        initialLyrics={editor ?? ""}
      />
      <ReportModal subject={report} onClose={() => setReport(null)} />
    </>
  );
};

export default Lyrics;
