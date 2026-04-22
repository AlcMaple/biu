import { useMemo } from "react";

import { Drawer, DrawerBody, DrawerContent, Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { RiArrowDownSLine, RiMusic2Line, RiSettings3Line } from "@remixicon/react";
import clsx from "classnames";
import { readableColor } from "color2k";
import { useShallow } from "zustand/shallow";

import { Themes } from "@/common/constants/theme";
import { hexToHsl, isHex, resolveTheme } from "@/common/utils/color";
import Empty from "@/components/empty";
import IconButton from "@/components/icon-button";
import Image from "@/components/image";
import Lyrics from "@/components/lyrics";
import MusicPlayControl from "@/components/music-play-control";
import MusicPlayMode from "@/components/music-play-mode";
import MusicPlayProgress from "@/components/music-play-progress";
import OpenPlaylistDrawerButton from "@/components/open-playlist-drawer-button";
import { useFullScreenPlayerSettings } from "@/store/full-screen-player-settings";
import { useModalStore } from "@/store/modal";
import { usePlayList } from "@/store/play-list";
import { useSettings } from "@/store/settings";

import { useGlassmorphism } from "./glassmorphism";
import FullScreenPlayerSettingsPanel from "./settings-panel";

const AndroidFullScreenPlayer = () => {
  const isOpen = useModalStore(s => s.isFullScreenPlayerOpen);
  const close = useModalStore(s => s.closeFullScreenPlayer);
  const { playId, list } = usePlayList(
    useShallow(state => ({
      playId: state.playId,
      list: state.list,
    })),
  );
  const primaryColor = useSettings(s => s.primaryColor);
  const themeMode = useSettings(s => s.themeMode);
  const { showLyrics, showCover, showBlurredBackground, backgroundColor, lyricsColor } = useFullScreenPlayerSettings(
    useShallow(s => ({
      showLyrics: s.showLyrics,
      showCover: s.showCover,
      showBlurredBackground: s.showBlurredBackground,
      backgroundColor: s.backgroundColor,
      lyricsColor: s.lyricsColor,
    })),
  );
  const playItem = list.find(item => item.id === playId);
  const coverSrc = playItem?.pageCover || playItem?.cover;

  const { effectsProfile, bgLayerA, bgLayerB, activeBgLayer, cssVars } = useGlassmorphism(
    coverSrc,
    primaryColor,
    isOpen,
  );

  const computedForegroundHex = useMemo(() => {
    if (showBlurredBackground) return undefined;
    const baseBg =
      backgroundColor && isHex(backgroundColor) ? backgroundColor : Themes[resolveTheme(themeMode)].colors!.background;
    try {
      return readableColor(baseBg as string);
    } catch {
      return undefined;
    }
  }, [backgroundColor, themeMode, showBlurredBackground]);

  const themeVars = useMemo(() => {
    const vars: React.CSSProperties = {
      ...cssVars,
      ["--heroui-primary" as any]: hexToHsl(primaryColor),
    };
    if (computedForegroundHex) {
      vars["--heroui-foreground" as any] = hexToHsl(computedForegroundHex);
    }
    return vars;
  }, [cssVars, primaryColor, computedForegroundHex]);

  const appTheme = useMemo(() => resolveTheme(themeMode), [themeMode]);

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
        className={clsx("bg-background text-foreground relative h-full overflow-hidden", {
          dark: showBlurredBackground || appTheme === "dark",
          light: !showBlurredBackground && appTheme === "light",
        })}
        style={themeVars}
      >
        {onClose =>
          !isOpen ? (
            <Empty />
          ) : (
            <DrawerBody className="relative flex flex-col gap-0 overflow-hidden bg-transparent p-0">
              {!showBlurredBackground && (
                <div aria-hidden className="absolute inset-0 -z-10" style={{ backgroundColor }} />
              )}
              {showBlurredBackground && (
                <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                  <div
                    className="absolute inset-0"
                    style={{
                      opacity: activeBgLayer === "a" ? 1 : 0,
                      transition: `opacity ${effectsProfile.transitionMs}ms ease`,
                    }}
                  >
                    {bgLayerA.coverSrc && (
                      <div
                        className="absolute inset-0 scale-[1.15] bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${bgLayerA.coverSrc})`,
                          filter: `blur(${effectsProfile.blurPx}px)`,
                          opacity: 0.92,
                        }}
                      />
                    )}
                    <div className="absolute inset-0" style={{ background: bgLayerA.gradientBackground }} />
                  </div>
                  <div
                    className="absolute inset-0"
                    style={{
                      opacity: activeBgLayer === "b" ? 1 : 0,
                      transition: `opacity ${effectsProfile.transitionMs}ms ease`,
                    }}
                  >
                    {bgLayerB.coverSrc && (
                      <div
                        className="absolute inset-0 scale-[1.15] bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${bgLayerB.coverSrc})`,
                          filter: `blur(${effectsProfile.blurPx}px)`,
                          opacity: 0.92,
                        }}
                      />
                    )}
                    <div className="absolute inset-0" style={{ background: bgLayerB.gradientBackground }} />
                  </div>
                </div>
              )}

              <div className="relative z-20 flex flex-none items-center justify-between gap-2 px-3 py-3">
                <IconButton title="关闭弹窗" onPress={onClose}>
                  <RiArrowDownSLine size={26} />
                </IconButton>
                <h2 className="min-w-0 flex-1 truncate text-center text-base font-medium select-none">
                  {playItem.pageTitle || playItem.title}
                </h2>
                <Popover placement="bottom-end">
                  <PopoverTrigger>
                    <IconButton title="设置">
                      <RiSettings3Line size={20} />
                    </IconButton>
                  </PopoverTrigger>
                  <PopoverContent className="max-h-[70vh] overflow-auto p-4">
                    <FullScreenPlayerSettingsPanel isUiVisible />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6">
                {showCover && (
                  <div className="flex w-full flex-none items-center justify-center">
                    <Image
                      src={coverSrc}
                      width={260}
                      height={195}
                      emptyPlaceholder={<RiMusic2Line size="40%" className="text-default-400" />}
                      className="rounded-xl select-none"
                      style={{
                        boxShadow: coverSrc
                          ? `0 24px 60px -28px rgb(var(--glow-rgb) / 0.55), 0 10px 24px -16px rgb(0 0 0 / 0.55)`
                          : undefined,
                      }}
                    />
                  </div>
                )}
                {showLyrics && (
                  <div className="min-h-0 w-full flex-1 overflow-hidden">
                    <Lyrics color={lyricsColor} centered showControls={false} />
                  </div>
                )}
                {!showLyrics && !showCover && <Empty />}
              </div>

              <div className="relative z-20 flex flex-none flex-col gap-2 px-6 pt-2 pb-6">
                <MusicPlayProgress className="w-full" trackClassName="h-[4px]" />
                <div className="flex items-center justify-between">
                  <MusicPlayMode />
                  <MusicPlayControl />
                  <OpenPlaylistDrawerButton />
                </div>
              </div>
            </DrawerBody>
          )
        }
      </DrawerContent>
    </Drawer>
  );
};

export default AndroidFullScreenPlayer;
