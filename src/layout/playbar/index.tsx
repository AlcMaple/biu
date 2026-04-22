import { useEffect } from "react";

import { Card } from "@heroui/react";

import { isAndroid } from "@/platform";
import { usePlayList } from "@/store/play-list";

import AndroidPlayBar from "./android";
import Center from "./center";
import Left from "./left";
import Right from "./right";

/**
 * 播放任务栏
 */
function PlayBar() {
  const playId = usePlayList(s => s.playId);
  const init = usePlayList(s => s.init);

  useEffect(() => {
    init();
  }, [init]);

  if (isAndroid) {
    return <AndroidPlayBar />;
  }

  return (
    <Card
      radius="none"
      shadow="sm"
      className="bg-background grid h-full grid-cols-[minmax(0,1fr)_minmax(0,3fr)_minmax(0,1fr)] px-4"
    >
      <div className="h-full">{Boolean(playId) && <Left />}</div>
      <Center />
      <Right />
    </Card>
  );
}

export default PlayBar;
