import { useCallback, useEffect, useRef, useState } from "react";

import { Drawer, DrawerBody, DrawerContent, Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { RiArrowDownSLine, RiSettings3Line } from "@remixicon/react";
import clsx from "classnames";
import { useShallow } from "zustand/shallow";

import Empty from "@/components/empty";
import FullScreenPlayerSettingsPanel from "@/components/full-screen-player/settings-panel";
import IconButton from "@/components/icon-button";
import Lyrics from "@/components/lyrics";
import MusicPlayControl from "@/components/music-play-control";
import MusicPlayProgress from "@/components/music-play-progress";
import WindowAction from "@/components/window-action";
import { useFancyPlayerImages } from "@/store/fancy-player-images";
import { useFullScreenPlayerSettings } from "@/store/full-screen-player-settings";
import { useModalStore } from "@/store/modal";
import { usePlayList } from "@/store/play-list";

const platform = window.electron.getPlatform();

/** 将路径转为 <img src> 可用的字符串 */
const toImgSrc = (path: string) => {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) return path;
  const normalized = path.replace(/\\/g, "/");
  return `file://${normalized.startsWith("/") ? "" : "/"}${normalized}`;
};

/** 将路径转为 CSS background-image url() */
const toBgUrl = (path: string) => {
  const src = toImgSrc(path);
  return src ? `url("${src}")` : "";
};

const FancyFullScreenPlayer = () => {
  const isOpen = useModalStore(s => s.isFullScreenPlayerOpen);
  const close = useModalStore(s => s.closeFullScreenPlayer);
  const { playId, list } = usePlayList(useShallow(s => ({ playId: s.playId, list: s.list })));
  const playItem = list.find(item => item.id === playId);
  const { showLyrics } = useFullScreenPlayerSettings(useShallow(s => ({ showLyrics: s.showLyrics })));
  const { getRandomImage } = useFancyPlayerImages(useShallow(s => ({ getRandomImage: s.getRandomImage })));

  /**
   * 双缓冲背景：imgA / imgB 各自持有一张图片，activeBg 决定哪层可见。
   * 切歌时将新图写入非活跃层，再切换 activeBg，实现无缝交叉淡入淡出。
   * 背景层与卡片共用同一套 A/B 状态，保证完全同步。
   */
  const [imgA, setImgA] = useState("");
  const [imgB, setImgB] = useState("");
  const [activeBg, setActiveBg] = useState<"a" | "b">("a");

  // Refs 保证 effect 中始终读到最新值，避免 stale closure
  const imgARef = useRef("");
  const imgBRef = useRef("");
  const activeBgRef = useRef<"a" | "b">("a");
  imgARef.current = imgA;
  imgBRef.current = imgB;
  activeBgRef.current = activeBg;

  const [isUiVisible, setIsUiVisible] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const hideUiTimeoutRef = useRef<number | null>(null);
  const prevPlayIdRef = useRef<string | null>(null);
  const preloaderRef = useRef<HTMLImageElement | null>(null);

  /** 预加载图片，加载完成后再执行回调，避免切换时出现空白或屏闪 */
  const preloadThenSwitch = useCallback((nextPath: string, onReady: () => void) => {
    // 取消上一次未完成的预加载
    if (preloaderRef.current) {
      preloaderRef.current.onload = null;
      preloaderRef.current.onerror = null;
      preloaderRef.current = null;
    }
    const src = toImgSrc(nextPath);
    const img = new window.Image();
    img.onload = () => {
      preloaderRef.current = null;
      onReady();
    };
    img.onerror = () => {
      preloaderRef.current = null;
      onReady(); // 加载失败也执行切换，不卡住
    };
    preloaderRef.current = img;
    img.src = src;
  }, []);

  /** 切歌时预加载新图，加载完成后写入非活跃层再切换 */
  useEffect(() => {
    if (!playId || playId === prevPlayIdRef.current) return;
    prevPlayIdRef.current = playId;

    const currentActive = activeBgRef.current;
    const activeImage = currentActive === "a" ? imgARef.current : imgBRef.current;
    const next = getRandomImage(activeImage || undefined) ?? "";
    if (!next) return;

    preloadThenSwitch(next, () => {
      if (currentActive === "a") {
        setImgB(next);
        imgBRef.current = next;
        setActiveBg("b");
        activeBgRef.current = "b";
      } else {
        setImgA(next);
        imgARef.current = next;
        setActiveBg("a");
        activeBgRef.current = "a";
      }
    });
  }, [playId, getRandomImage, preloadThenSwitch]);

  /** 首次打开时预加载并设置到活跃层 A */
  useEffect(() => {
    if (isOpen && !imgARef.current && !imgBRef.current) {
      const img = getRandomImage() ?? "";
      if (!img) return;
      preloadThenSwitch(img, () => {
        setImgA(img);
        imgARef.current = img;
      });
    }
  }, [isOpen, getRandomImage, preloadThenSwitch]);

  useEffect(() => {
    if (isOpen) setIsUiVisible(true);
  }, [isOpen]);

  useEffect(
    () => () => {
      if (hideUiTimeoutRef.current) window.clearTimeout(hideUiTimeoutRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!isUiVisible && isSettingsOpen) setIsSettingsOpen(false);
  }, [isUiVisible, isSettingsOpen]);

  const scheduleHideUi = (delay: number) => {
    if (isSettingsOpen) return;
    if (hideUiTimeoutRef.current) window.clearTimeout(hideUiTimeoutRef.current);
    hideUiTimeoutRef.current = window.setTimeout(() => setIsUiVisible(false), delay);
  };

  const handleMouseEnter = () => {
    if (hideUiTimeoutRef.current) {
      window.clearTimeout(hideUiTimeoutRef.current);
      hideUiTimeoutRef.current = null;
    }
    if (!isUiVisible) setIsUiVisible(true);
  };

  if (!playItem) return null;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={close}
      placement="bottom"
      size="full"
      radius="none"
      isDismissable={false}
      hideCloseButton
    >
      <DrawerContent
        className="dark relative h-full overflow-hidden bg-black"
        style={{
          cursor: isUiVisible ? "auto" : "none",
          // 覆盖 HeroUI 主色为白色，使按钮/控件与精美播放器白色风格一致
          ["--heroui-primary" as any]: "0 0% 100%",
          ["--heroui-primary-foreground" as any]: "0 0% 0%",
        }}
      >
        {onClose =>
          !isOpen ? (
            <Empty />
          ) : (
            <DrawerBody
              className="relative flex flex-col gap-0 overflow-hidden bg-transparent p-0 text-white select-none"
              style={{ drop_shadow: "0 0 2px rgba(255,255,255,0.3)" } as React.CSSProperties}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={() => scheduleHideUi(3000)}
              onMouseMove={() => {
                if (!isUiVisible) setIsUiVisible(true);
                scheduleHideUi(3000);
              }}
            >
              {/* ══ CSS 动画定义 ══ */}
              <style>{`
                @keyframes fancy-bg-drift {
                  0%   { transform: scale(1.15) translate(0%,    0%);   }
                  25%  { transform: scale(1.12) translate(-2%,  -1.5%); }
                  50%  { transform: scale(1.18) translate(-1%,   2%);   }
                  75%  { transform: scale(1.12) translate( 2%,   1%);   }
                  100% { transform: scale(1.15) translate(0%,    0%);   }
                }
                @keyframes fancy-breathing-glow {
                  0%, 100% {
                    text-shadow: 0 0 15px rgba(255,255,255,0.8), 0 0 30px rgba(255,255,255,0.4);
                  }
                  50% {
                    text-shadow: 0 0 20px rgba(255,255,255,0.9), 0 0 40px rgba(255,255,255,0.6);
                  }
                }
              `}</style>

              {/* ══ 背景层 A ══ */}
              <div
                aria-hidden
                className="pointer-events-none fixed inset-0 z-0"
                style={{ opacity: activeBg === "a" ? 1 : 0, transition: "opacity 1200ms ease" }}
              >
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage: toBgUrl(imgA),
                    animation: "fancy-bg-drift 20s ease-in-out infinite",
                    willChange: "transform",
                  }}
                />
              </div>

              {/* ══ 背景层 B ══ */}
              <div
                aria-hidden
                className="pointer-events-none fixed inset-0 z-0"
                style={{ opacity: activeBg === "b" ? 1 : 0, transition: "opacity 1200ms ease" }}
              >
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage: toBgUrl(imgB),
                    animation: "fancy-bg-drift 20s ease-in-out infinite",
                    willChange: "transform",
                  }}
                />
              </div>

              {/* 黑色半透明遮罩 */}
              <div
                aria-hidden
                className="pointer-events-none fixed inset-0 z-[1]"
                style={{ background: "rgba(0,0,0,0.20)" }}
              />

              {/* ══ 主容器：flex 纵向布局，与 HTML 完全对应 ══ */}
              <div className="relative z-10 flex h-full w-full flex-col px-[5%] pt-8">
                {/* ── Header ── */}
                <header className="mb-4 flex items-center justify-between">
                  <div
                    className={clsx(
                      "window-no-drag flex items-center space-x-2 transition-opacity duration-200",
                      isUiVisible ? "opacity-100" : "pointer-events-none opacity-0",
                    )}
                  >
                    <IconButton title="关闭" onPress={onClose}>
                      <RiArrowDownSLine size={28} />
                    </IconButton>
                    <span
                      className="text-2xl tracking-widest text-white/90 italic select-none"
                      style={{ fontFamily: "Georgia, 'Noto Serif', serif" }}
                    >
                      {playItem.pageTitle || playItem.title}
                    </span>
                    <Popover
                      isOpen={isSettingsOpen && isUiVisible}
                      onOpenChange={open => {
                        setIsSettingsOpen(open);
                        if (open) {
                          if (hideUiTimeoutRef.current) {
                            window.clearTimeout(hideUiTimeoutRef.current);
                            hideUiTimeoutRef.current = null;
                          }
                          setIsUiVisible(true);
                        }
                      }}
                      placement="bottom-start"
                    >
                      <PopoverTrigger>
                        <IconButton title="设置" tooltip="设置">
                          <RiSettings3Line size={22} />
                        </IconButton>
                      </PopoverTrigger>
                      <PopoverContent className="p-4">
                        <FullScreenPlayerSettingsPanel isUiVisible={isUiVisible} />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="window-no-drag">
                    {(platform === "linux" || platform === "windows") && isUiVisible && <WindowAction />}
                  </div>
                </header>

                {/* ── Main（flex-grow 撑满中间区域）── */}
                <main className="flex min-h-0 flex-grow items-center justify-between">
                  {/* 左侧：专辑卡片（与背景图同一张图） */}
                  <div className="flex w-1/2 items-center justify-start">
                    <div className="group relative">
                      {/* 装饰线 */}
                      <div className="absolute -top-12 -left-12 hidden h-px w-24 bg-white/30 lg:block" />
                      <div className="absolute -right-12 -bottom-12 hidden h-24 w-px bg-white/30 lg:block" />

                      {/* 卡片本体 —— 与背景共用同一套 A/B 双缓冲，保证同步过渡 */}
                      <div
                        className="h-[24rem] w-[24rem] transform overflow-hidden rounded-[3rem] shadow-2xl transition-transform duration-700 group-hover:scale-[1.02] xl:h-[32rem] xl:w-[32rem] xl:rounded-[4rem]"
                        style={{ boxShadow: "0 40px 100px -20px rgba(0,0,0,0.5)" }}
                      >
                        {imgA || imgB ? (
                          <div className="relative h-full w-full">
                            <img
                              alt=""
                              src={toImgSrc(imgA)}
                              className="absolute inset-0 h-full w-full object-cover"
                              style={{ opacity: activeBg === "a" ? 1 : 0, transition: "opacity 1200ms ease" }}
                              draggable={false}
                            />
                            <img
                              alt="背景图"
                              src={toImgSrc(imgB)}
                              className="absolute inset-0 h-full w-full object-cover"
                              style={{ opacity: activeBg === "b" ? 1 : 0, transition: "opacity 1200ms ease" }}
                              draggable={false}
                            />
                          </div>
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-white/10 text-6xl text-white/30">
                            ♪
                          </div>
                        )}
                      </div>

                      {/* 竖排装饰文字 */}
                      <div
                        className="absolute top-1/2 -right-12 flex -translate-y-1/2 flex-col items-center xl:-right-16"
                        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
                      >
                        <span className="mb-4 text-[9px] tracking-[0.4em] text-white/50 uppercase xl:text-[10px]">
                          Now Playing
                        </span>
                        <span
                          className="text-xl text-white/80 italic xl:text-2xl"
                          style={{ fontFamily: "Georgia, 'Noto Serif', serif" }}
                        >
                          {playItem.ownerName || "—"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 右侧：歌曲信息 + 歌词 */}
                  <div className="flex h-full min-h-0 w-1/2 flex-col justify-center pl-8 xl:pl-12">
                    {/* 标题 & 作者 */}
                    <div className="mb-8 xl:mb-12">
                      <h1
                        className="mb-2 text-4xl leading-tight tracking-tight text-white italic drop-shadow-md xl:text-6xl"
                        style={{
                          fontFamily: "Georgia, 'Noto Serif', serif",
                          textShadow: "0 0 15px rgba(255,255,255,0.8), 0 0 30px rgba(255,255,255,0.4)",
                        }}
                      >
                        {playItem.pageTitle || playItem.title}
                      </h1>
                      <div className="flex items-center gap-4">
                        <div className="h-px w-8 bg-white/40" />
                        <p
                          className="text-lg text-white/90 xl:text-xl"
                          style={{ fontFamily: "Georgia, 'Noto Serif', serif" }}
                        >
                          {playItem.ownerName}
                        </p>
                      </div>
                    </div>

                    {/* 歌词 */}
                    {showLyrics && (
                      <div
                        className="h-auto max-h-[30vh] overflow-hidden pr-12 xl:max-h-[350px]"
                        style={{
                          maskImage: "linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
                        }}
                      >
                        <Lyrics color="#ffffff" centered={false} showControls={isUiVisible} />
                      </div>
                    )}
                  </div>
                </main>

                {/* ── Footer ── */}
                <footer className="mt-auto flex flex-col pb-2 xl:pb-4">
                  {/* 进度条行 */}
                  <div className="mb-4 flex w-full items-center gap-6 xl:mb-6">
                    <MusicPlayProgress className="w-full" trackClassName="h-[2px]" />
                  </div>

                  {/* 控制按钮 —— 玻璃胶囊，max-w-md，与 HTML 一致 */}
                  <div className="mx-auto mb-2 flex w-full max-w-md items-center justify-center">
                    <div
                      className="flex w-full items-center justify-center rounded-full border border-white/20 px-12 py-2 shadow-xl xl:py-3"
                      style={{
                        background: "rgba(255,255,255,0.15)",
                        backdropFilter: "blur(24px)",
                        WebkitBackdropFilter: "blur(24px)",
                      }}
                    >
                      <MusicPlayControl />
                    </div>
                  </div>
                </footer>
              </div>

              {/* ══ 右下角装饰文字（fixed，与 HTML bottom-20 一致）══ */}
              <div
                aria-hidden
                className="pointer-events-none fixed right-12 bottom-20 z-0 flex flex-col items-end opacity-80 xl:bottom-24"
              >
                <div
                  className="text-5xl leading-none text-white xl:text-6xl"
                  style={{
                    writingMode: "vertical-rl",
                    fontFamily: "Georgia, 'Noto Serif', serif",
                  }}
                >
                  {playItem.title?.slice(0, 4) || "♪"}
                </div>
                <div className="mt-4 h-[80px] w-px bg-white xl:h-[100px]" />
              </div>
            </DrawerBody>
          )
        }
      </DrawerContent>
    </Drawer>
  );
};

export default FancyFullScreenPlayer;
