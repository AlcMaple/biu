import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { addToast, useDisclosure } from "@heroui/react";
import { RiTBoxLine } from "@remixicon/react";
import clsx from "classnames";
import { debounce } from "es-toolkit";

import { parseLrc } from "@/components/lyrics/parse-lrc";
import platform from "@/platform";
import { useLyricsState } from "@/store/lyrics-state";
import { usePlayList } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";
import { StoreNameMap } from "@shared/store";

import IconButton from "../icon-button";
import LyricsSearchModal from "../lyrics-search-modal";
import FontSizeControl from "./font-size-control";
import OffsetControl from "./offset-control";

type PlayItem = ReturnType<ReturnType<typeof usePlayList.getState>["getPlayItem"]>;

const activeTextBase = "text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.35)]";

const DEFAULT_FONT_SIZE = 20;

const Lyrics = ({ color, centered, showControls }: { color?: string; centered?: boolean; showControls?: boolean }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [centerPadding, setCenterPadding] = useState(0);
  const playId = usePlayList(s => s.playId);
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);

  // 拖拽校准：按住任意一行向上/下拖动，让该行对齐到屏幕中央（当前演唱锚点），
  // 松手时将整条歌词时间轴按 `offset = line.time - currentTime*1000` 平移。
  // `index === null` 表示未进入拖拽态（仅按下未越过 5px 阈值时同样为 null）。
  const [calibration, setCalibration] = useState<{ index: number; dy: number } | null>(null);

  // Read lyrics state from shared store (owned by LyricsBroadcaster)
  const lyrics = useLyricsState(s => s.lyrics);
  const translatedLyrics = useLyricsState(s => s.translatedLyrics);
  const offset = useLyricsState(s => s.offset);
  const isLoading = useLyricsState(s => s.isLoading);

  const { currentTime } = usePlayProgress();
  const currentMs = currentTime * 1000 + offset;

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

  const activeIndex = useMemo(() => {
    if (!lyrics.length) return -1;
    for (let i = lyrics.length - 1; i >= 0; i -= 1) {
      if (currentMs >= lyrics[i].time) return i;
    }
    return 0;
  }, [currentMs, lyrics]);

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

  const handleCalibrationPointerDown = useCallback(
    (lineIndex: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (!showControls) return;
      if (e.button !== 0) return; // 仅响应主键（左键 / 主触点）
      const startY = e.clientY;
      let started = false;
      const pointerId = e.pointerId;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dy = ev.clientY - startY;
        if (!started) {
          if (Math.abs(dy) < 5) return;
          started = true;
          document.body.style.userSelect = "none";
        }
        setCalibration({ index: lineIndex, dy });
      };

      const finish = (commit: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        document.body.style.userSelect = "";
        if (!started) {
          setCalibration(null);
          return;
        }
        if (commit) {
          const line = useLyricsState.getState().lyrics[lineIndex];
          if (line) {
            const now = usePlayProgress.getState().currentTime * 1000;
            const nextOffset = Math.round(line.time - now);
            handleOffsetChange(nextOffset);
            addToast({
              color: "success",
              title: `歌词已校准 (${nextOffset >= 0 ? "+" : ""}${nextOffset} ms)`,
            });
          }
        }
        setCalibration(null);
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        finish(true);
      };
      // 浏览器/系统层级抢走 pointer（右键、alt-tab 等）时回滚，不提交校准
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        finish(false);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [showControls, handleOffsetChange],
  );

  const handleLyricsAdopted = useCallback(
    (nextLyrics?: string, nextTLyrics?: string) => {
      onCloseSearch();
      if (nextLyrics) {
        useLyricsState.getState().setLyrics(parseLrc(nextLyrics), nextTLyrics ? parseLrc(nextTLyrics) : []);
      }
    },
    [onCloseSearch],
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
    if (calibration) return; // 拖拽校准期间冻结自动滚动，避免行位置跳变干扰对齐
    const wrapper = containerRef.current;
    if (activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    if (el && wrapper) {
      const top = el.offsetTop - wrapper.clientHeight / 2 + el.clientHeight / 2;
      wrapper.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }, [activeIndex, centerPadding, calibration]);

  const renderLine = (line: { time: number; text: string }, index: number) => {
    const isActive = index === activeIndex;
    const translation = translationMap.get(line.time);
    const activeWeight = isActive ? "font-extrabold" : "font-normal";
    const activeShadow = isActive ? activeTextBase : "";
    const isDragging = calibration?.index === index;
    const dragDy = isDragging ? calibration!.dy : 0;

    return (
      <div
        key={`${line.time}-${index}`}
        ref={node => {
          lineRefs.current[index] = node;
        }}
        onPointerDown={showControls ? handleCalibrationPointerDown(index) : undefined}
        className={clsx(
          "w-full py-2 transition-all duration-300 ease-out",
          centered ? "text-center" : "text-left",
          isActive ? "opacity-100" : "opacity-60",
          showControls && !calibration && "cursor-grab",
          isDragging && "cursor-grabbing",
        )}
        style={{
          fontSize: isActive ? fontSize * 1.5 : fontSize,
          transform: isDragging ? `translateY(${dragDy}px)` : "none",
          transition: isDragging ? "none" : undefined,
          position: isDragging ? "relative" : undefined,
          zIndex: isDragging ? 20 : undefined,
          touchAction: showControls ? "none" : undefined,
        }}
      >
        <div
          className={clsx("leading-snug break-words whitespace-pre-wrap", activeWeight, activeShadow)}
          style={{ color: color || undefined }}
        >
          {line.text}
        </div>
        {translation ? (
          <div className="mt-1 text-sm break-words whitespace-pre-wrap text-white/80">{translation}</div>
        ) : null}
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
              className="space-y-2"
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

        {/*
          校准参考线 + 顶部提示横幅。背景在 fancy-player 等场景里是用户随机的图片
          （亮/暗、纯/杂都可能），所以参考线必须自带高对比度的边缘，标签必须有
          独立的对比层。
          - 参考线：白色渐变 + 双向阴影（外发光黑色 + 微弱白色光晕），亮底/暗底都看得清。
          - 顶部横幅：黑底白字 + 半透明白描边 + 文字阴影 + backdrop-blur，与歌词文本
            和右下角控件完全错开。
        */}
        {calibration ? (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 left-0 z-10"
              style={{ top: "50%", transform: "translateY(-50%)" }}
            >
              <div
                className="h-px w-full"
                style={{
                  background:
                    "linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 18%, rgba(255,255,255,0.95) 82%, rgba(255,255,255,0) 100%)",
                  boxShadow: "0 0 6px rgba(0,0,0,0.6), 0 0 14px rgba(255,255,255,0.4)",
                }}
              />
            </div>
            <div aria-hidden className="pointer-events-none absolute top-4 left-1/2 z-20 -translate-x-1/2">
              <span
                className="rounded-full px-3 py-1 text-[11px] font-semibold whitespace-nowrap text-white"
                style={{
                  background: "rgba(0,0,0,0.78)",
                  boxShadow: "0 0 0 1px rgba(255,255,255,0.25), 0 4px 12px rgba(0,0,0,0.55)",
                  textShadow: "0 1px 2px rgba(0,0,0,0.9)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              >
                拖动到中央基准线 · 松开校准
              </span>
            </div>
          </>
        ) : null}

        {showControls && (
          <div className="text-foreground/80 pointer-events-none absolute right-6 bottom-6 flex flex-col items-center space-y-3 text-sm transition-opacity duration-200">
            <div className="pointer-events-auto">
              <FontSizeControl value={fontSize} onChange={handleFontSizeChange} onOpenChange={() => {}} />
            </div>
            <div className="pointer-events-auto">
              <OffsetControl value={offset} onChange={handleOffsetChange} onOpenChange={() => {}} />
            </div>
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
    </>
  );
};

export default Lyrics;
