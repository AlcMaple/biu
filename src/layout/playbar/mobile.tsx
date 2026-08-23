import { useMemo } from "react";

import { Card, Slider } from "@heroui/react";
import { RiMusic2Line, RiPauseCircleFill, RiPlayCircleFill, RiSkipBackFill, RiSkipForwardFill } from "@remixicon/react";

import IconButton from "@/components/icon-button";
import Image from "@/components/image";
import MusicPlayMode from "@/components/music-play-mode";
import OpenPlaylistDrawerButton from "@/components/open-playlist-drawer-button";
import { useModalStore } from "@/store/modal";
import { usePlayList } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";

const MobilePlayBar = () => {
  const list = usePlayList(s => s.list);
  const playId = usePlayList(s => s.playId);
  const togglePlay = usePlayList(s => s.togglePlay);
  const next = usePlayList(s => s.next);
  const prev = usePlayList(s => s.prev);
  const isPlaying = usePlayList(s => s.isPlaying);
  const duration = usePlayList(s => s.duration);
  const seek = usePlayList(s => s.seek);
  const currentTime = usePlayProgress(s => s.currentTime);
  const openFullScreen = useModalStore(s => s.openFullScreenPlayer);

  const playItem = useMemo(() => list.find(item => item.id === playId), [list, playId]);
  const isEmptyPlayList = list.length === 0;
  const isSingle = list.length === 1;

  return (
    <Card radius="none" shadow="sm" className="bg-background flex h-full flex-col gap-1 px-2 pt-1">
      <Slider
        aria-label="播放进度"
        hideThumb
        minValue={0}
        maxValue={duration || 0}
        value={currentTime}
        onChange={v => seek(v as number)}
        isDisabled={isEmptyPlayList}
        size="sm"
        className="px-1"
        classNames={{
          track: "h-[2px]",
        }}
      />
      <div className="flex min-h-0 flex-1 items-center gap-2">
        <div
          className="flex min-w-0 flex-1 items-center gap-2"
          onClick={() => {
            if (playItem) openFullScreen();
          }}
        >
          <Image
            src={playItem?.pageCover || playItem?.cover}
            width={44}
            height={44}
            radius="md"
            emptyPlaceholder={<RiMusic2Line />}
            params="672w_378h_1c.avif"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm">{playItem?.pageTitle || playItem?.title || "未在播放"}</span>
            <span className="text-foreground-500 truncate text-xs">
              {playItem?.source === "local" ? "本地音乐" : playItem?.ownerName || ""}
            </span>
          </div>
        </div>
        {/* 顺序：上一首 / 播放 / 下一首 / 播放顺序 / 播放列表 */}
        <div className="flex flex-none items-center">
          <IconButton radius="md" onPress={prev} isDisabled={isEmptyPlayList || isSingle} aria-label="上一首">
            <RiSkipBackFill size={22} />
          </IconButton>
          <IconButton isDisabled={isEmptyPlayList} radius="full" onPress={togglePlay} className="size-11 min-w-11">
            {isPlaying ? <RiPauseCircleFill size={40} /> : <RiPlayCircleFill size={40} />}
          </IconButton>
          <IconButton radius="md" onPress={next} isDisabled={isEmptyPlayList || isSingle} aria-label="下一首">
            <RiSkipForwardFill size={22} />
          </IconButton>
          <MusicPlayMode />
          <OpenPlaylistDrawerButton />
        </div>
      </div>
    </Card>
  );
};

export default MobilePlayBar;
