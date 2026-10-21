import { useEffect, useState } from "react";

import { Button, Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { RiFullscreenLine, RiPictureInPicture2Line } from "@remixicon/react";

import { useIsTabletLayout } from "@/common/hooks/use-responsive";
import IconButton from "@/components/icon-button";
import MusicDownloadButton from "@/components/music-download-button";
import MusicPlayMode from "@/components/music-play-mode";
import MusicRate from "@/components/music-rate";
import MusicVolume from "@/components/music-volume";
import OpenPlaylistDrawerButton from "@/components/open-playlist-drawer-button";
import platform, { isElectron } from "@/platform";
import { useModalStore } from "@/store/modal";
import { usePlayList } from "@/store/play-list";

const RightControl = () => {
  const playId = usePlayList(s => s.playId);
  const getPlayItem = usePlayList(s => s.getPlayItem);
  const [desktopLyricsOn, setDesktopLyricsOn] = useState(false);
  const [lyricsMenuOpen, setLyricsMenuOpen] = useState(false);
  const openFullScreenPlayer = useModalStore(s => s.openFullScreenPlayer);
  // 平板宽度收起下载 / 音量 / 倍速；播放顺序和播放列表要留着，
  // 它们在平板下没有第二个入口（移动端的播放顺序放在迷你播放栏里）。
  const isTabletLayout = useIsTabletLayout();

  useEffect(() => {
    return platform.onDesktopLyricsVisibilityChange(setDesktopLyricsOn);
  }, []);

  const handleToggleDesktopLyrics = async () => {
    setDesktopLyricsOn(await platform.toggleDesktopLyrics());
  };

  return (
    <div
      className={
        isTabletLayout ? "flex h-full items-center justify-end" : "flex h-full items-center justify-end space-x-2"
      }
    >
      <MusicPlayMode />
      {!isTabletLayout && Boolean(playId) && getPlayItem()?.source !== "local" && <MusicDownloadButton />}
      <OpenPlaylistDrawerButton />
      {!isTabletLayout && <MusicVolume />}
      {!isTabletLayout && <MusicRate />}
      {/* 「词」是歌词总入口：Electron 下点开选「歌词页面」或「桌面歌词」，没有桌面歌词的平台直接进歌词页面 */}
      {isElectron && !isTabletLayout ? (
        <Popover placement="top" isOpen={lyricsMenuOpen} onOpenChange={setLyricsMenuOpen} disableAnimation>
          <PopoverTrigger>
            <IconButton
              aria-label="歌词"
              className={desktopLyricsOn ? "text-primary min-w-fit px-2 text-[16px]" : "min-w-fit px-2 text-[16px]"}
            >
              词
            </IconButton>
          </PopoverTrigger>
          <PopoverContent className="p-1">
            <div className="flex w-40 flex-col">
              <Button
                variant="light"
                className="justify-start"
                startContent={<RiFullscreenLine size={18} />}
                onPress={() => {
                  setLyricsMenuOpen(false);
                  openFullScreenPlayer();
                }}
              >
                歌词页面
              </Button>
              <Button
                variant="light"
                className={desktopLyricsOn ? "text-primary justify-start" : "justify-start"}
                startContent={<RiPictureInPicture2Line size={18} />}
                onPress={() => {
                  setLyricsMenuOpen(false);
                  void handleToggleDesktopLyrics();
                }}
              >
                {desktopLyricsOn ? "关闭桌面歌词" : "打开桌面歌词"}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <IconButton aria-label="歌词" className="min-w-fit px-2 text-[16px]" onPress={openFullScreenPlayer}>
          词
        </IconButton>
      )}
    </div>
  );
};

export default RightControl;
