import React, { useState } from "react";

import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@heroui/react";

import { PlayRate } from "@/common/constants/audio";
import { isWeb } from "@/platform/detect";
import { usePlayList } from "@/store/play-list";

import IconButton from "../icon-button";

const MusicRate = () => {
  const rate = usePlayList(s => s.rate);
  const setRate = usePlayList(s => s.setRate);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  const tooltipId = "rate-tooltip";
  const rateOptions = (
    <div className="flex flex-col items-center gap-1">
      {PlayRate.map(v => (
        <Button
          key={v}
          isIconOnly
          radius="md"
          size="sm"
          color={v === rate ? "primary" : "default"}
          variant={v === rate ? "solid" : "light"}
          className="min-w-[40px]"
          aria-label={`${v}倍速`}
          onPress={() => {
            setRate(v);
            if (isWeb) setIsTooltipOpen(false);
          }}
        >
          {v}x
        </Button>
      ))}
    </div>
  );

  if (isWeb) {
    return (
      <Popover placement="top" isOpen={isTooltipOpen} onOpenChange={setIsTooltipOpen} disableAnimation>
        <PopoverTrigger>
          <IconButton className="min-w-fit text-[16px]" aria-label={`播放速率，当前 ${rate} 倍`}>
            {rate}x
          </IconButton>
        </PopoverTrigger>
        <PopoverContent className="w-[60px] min-w-[60px] px-2 py-3">{rateOptions}</PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip
      disableAnimation
      triggerScaleOnOpen={false}
      isOpen={isTooltipOpen}
      onOpenChange={setIsTooltipOpen}
      placement="top"
      closeDelay={500}
      showArrow={false}
      classNames={{
        content: "py-3 px-2 w-[60px] min-w-[60px]",
      }}
      content={rateOptions}
    >
      <IconButton className="min-w-fit text-[16px]" aria-label="播放速率" aria-describedby={tooltipId}>
        {rate}x
      </IconButton>
    </Tooltip>
  );
};

export default MusicRate;
