import React from "react";

import { Popover, PopoverContent, PopoverTrigger, Switch, Tooltip } from "@heroui/react";
import { RiSettings3Line } from "@remixicon/react";

import { getPlayModeList, PlayMode } from "@/common/constants/audio";
import IconButton from "@/components/icon-button";
import { isWeb } from "@/platform/detect";
import { usePlayList } from "@/store/play-list";

const PlayModeList = getPlayModeList(18);

const MusicPlayMode = () => {
  const playMode = usePlayList(s => s.playMode);
  const togglePlayMode = usePlayList(s => s.togglePlayMode);
  const shouldKeepPagesOrderInRandomPlayMode = usePlayList(s => s.shouldKeepPagesOrderInRandomPlayMode);
  const setShouldKeepPagesOrderInRandomPlayMode = usePlayList(s => s.setShouldKeepPagesOrderInRandomPlayMode);
  const [isOpen, setIsOpen] = React.useState(false);
  const closeTimer = React.useRef<number | null>(null);

  const openPopover = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setIsOpen(true);
  };

  const closePopoverWithDelay = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
    }
    closeTimer.current = window.setTimeout(() => {
      setIsOpen(false);
      closeTimer.current = null;
    }, 150);
  };

  const currentMode = PlayModeList.find(item => item.value === playMode);

  if (isWeb) {
    const modeButton = (
      <IconButton className="flex-none" aria-label={currentMode?.desc ?? "播放模式"} onPress={togglePlayMode}>
        {currentMode?.icon}
      </IconButton>
    );

    if (playMode !== PlayMode.Random) {
      return modeButton;
    }

    return (
      <div className="flex items-center gap-1">
        {modeButton}
        <Popover placement="top" disableAnimation>
          <PopoverTrigger>
            <IconButton className="flex-none" aria-label="随机播放设置">
              <RiSettings3Line size={16} />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent>
            <div className="flex flex-col gap-2 px-2 py-1">
              <span className="text-default-500 text-xs">{currentMode?.desc}</span>
              <Switch
                size="sm"
                disableAnimation
                isSelected={shouldKeepPagesOrderInRandomPlayMode}
                onValueChange={setShouldKeepPagesOrderInRandomPlayMode}
              >
                保持分集顺序
              </Switch>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  if (playMode === PlayMode.Random) {
    return (
      <Tooltip
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        placement="top"
        closeDelay={150}
        content={
          <div className="flex flex-col gap-1" onMouseEnter={openPopover} onMouseLeave={closePopoverWithDelay}>
            <span className="text-default-500 text-xs">{currentMode?.desc}</span>
            <Switch
              size="sm"
              disableAnimation
              isSelected={shouldKeepPagesOrderInRandomPlayMode}
              onValueChange={setShouldKeepPagesOrderInRandomPlayMode}
            >
              保持分集顺序
            </Switch>
          </div>
        }
      >
        <IconButton
          className="flex-none"
          aria-label={currentMode?.desc ?? "播放模式"}
          onPress={togglePlayMode}
          onMouseEnter={openPopover}
          onMouseLeave={closePopoverWithDelay}
        >
          {currentMode?.icon}
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Tooltip placement="top" content={currentMode?.desc}>
      <IconButton className="flex-none" aria-label={currentMode?.desc ?? "播放模式"} onPress={togglePlayMode}>
        {currentMode?.icon}
      </IconButton>
    </Tooltip>
  );
};

export default MusicPlayMode;
