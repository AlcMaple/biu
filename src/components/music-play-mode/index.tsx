import React from "react";

import { Tooltip, Switch } from "@heroui/react";

import { getPlayModeList, PlayMode } from "@/common/constants/audio";
import IconButton from "@/components/icon-button";
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
