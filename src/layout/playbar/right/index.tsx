import { useEffect, useState } from "react";

import { Button } from "@heroui/react";
import { RiClosedCaptioningLine } from "@remixicon/react";

import { useIsTabletLayout } from "@/common/hooks/use-responsive";
import MusicDownloadButton from "@/components/music-download-button";
import MusicPlayMode from "@/components/music-play-mode";
import MusicRate from "@/components/music-rate";
import MusicVolume from "@/components/music-volume";
import OpenPlaylistDrawerButton from "@/components/open-playlist-drawer-button";
import PlatformTooltip from "@/components/platform-tooltip";
import platform, { isElectron } from "@/platform";
import { usePlayList } from "@/store/play-list";

const RightControl = () => {
  const playId = usePlayList(s => s.playId);
  const getPlayItem = usePlayList(s => s.getPlayItem);
  const [desktopLyricsOn, setDesktopLyricsOn] = useState(false);
  // 平板宽度收起下载 / 音量 / 倍速；播放顺序和播放列表要留着，
  // 它们在平板下没有第二个入口（移动端的播放顺序放在迷你播放栏里）。
  const isTabletLayout = useIsTabletLayout();

  useEffect(() => {
    return platform.onDesktopLyricsVisibilityChange(visible => {
      setDesktopLyricsOn(visible);
    });
  }, []);

  const handleToggleDesktopLyrics = async () => {
    const visible = await platform.toggleDesktopLyrics();
    setDesktopLyricsOn(visible);
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
      {/* 桌面歌词是 Electron 独占能力，Web 播放栏不展示入口 */}
      {isElectron && !isTabletLayout && (
        <PlatformTooltip content="桌面歌词" closeDelay={0}>
          <Button
            isIconOnly
            size="sm"
            variant={desktopLyricsOn ? "flat" : "light"}
            onPress={handleToggleDesktopLyrics}
            className={desktopLyricsOn ? "text-primary" : ""}
            aria-label="桌面歌词"
          >
            <RiClosedCaptioningLine size={18} />
          </Button>
        </PlatformTooltip>
      )}
    </div>
  );
};

export default RightControl;
