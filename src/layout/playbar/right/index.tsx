import { useEffect, useState } from "react";

import { Button, Tooltip } from "@heroui/react";
import { RiClosedCaptioningLine } from "@remixicon/react";

import MusicDownloadButton from "@/components/music-download-button";
import MusicPlayMode from "@/components/music-play-mode";
import MusicRate from "@/components/music-rate";
import MusicVolume from "@/components/music-volume";
import OpenPlaylistDrawerButton from "@/components/open-playlist-drawer-button";
import platform from "@/platform";
import { usePlayList } from "@/store/play-list";

const RightControl = () => {
  const playId = usePlayList(s => s.playId);
  const getPlayItem = usePlayList(s => s.getPlayItem);
  const [desktopLyricsOn, setDesktopLyricsOn] = useState(false);

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
    <div className="flex h-full items-center justify-end space-x-2">
      <MusicPlayMode />
      {Boolean(playId) && getPlayItem()?.source !== "local" && <MusicDownloadButton />}
      <OpenPlaylistDrawerButton />
      <MusicVolume />
      <MusicRate />
      <Tooltip content="桌面歌词" closeDelay={0}>
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
      </Tooltip>
    </div>
  );
};

export default RightControl;
