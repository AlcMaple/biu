import { useEffect, useState } from "react";

import { Button } from "@heroui/react";
import { RiPictureInPicture2Line } from "@remixicon/react";
import clsx from "classnames";

import platform from "@/platform";

const DesktopLyricsButton = () => {
  const [on, setOn] = useState(false);

  useEffect(() => platform.onDesktopLyricsVisibilityChange(setOn), []);

  return (
    <Button
      size="sm"
      radius="full"
      variant="flat"
      aria-pressed={on}
      onPress={() => platform.toggleDesktopLyrics()}
      className={clsx(
        "bg-foreground/20 hover:bg-foreground/30 h-8 min-w-0 gap-1 px-3 text-sm whitespace-nowrap",
        on ? "text-primary" : "text-foreground",
      )}
    >
      <RiPictureInPicture2Line size={16} />
      桌面歌词
    </Button>
  );
};

export default DesktopLyricsButton;
