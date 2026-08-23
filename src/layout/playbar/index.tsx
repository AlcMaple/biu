import { useEffect } from "react";

import { Card } from "@heroui/react";
import clx from "classnames";

import { useIsMobileLayout, useIsTabletLayout } from "@/common/hooks/use-responsive";
import { setVolumeBoost } from "@/common/utils/audio-graph";
import { restoreSession } from "@/store/heartbeat";
import { usePlayList } from "@/store/play-list";
import { useSettings } from "@/store/settings";

import Center from "./center";
import Left from "./left";
import MobilePlayBar from "./mobile";
import Right from "./right";

/**
 * 播放任务栏
 */
function PlayBar() {
  const playId = usePlayList(s => s.playId);
  const init = usePlayList(s => s.init);
  const volumeBoost = useSettings(s => s.volumeBoost);
  const isMobileLayout = useIsMobileLayout();
  const isTabletLayout = useIsTabletLayout();

  useEffect(() => {
    init();
    // 恢复上次的私人FM 会话（重启后接着放、续供接上）。放这儿是因为 PlayBar 只在主窗挂载：
    // 三窗共用一个 bundle，每个窗口都恢复会各挂一个续供订阅 → 队列见底时重复抓取 / 重复入队。
    void restoreSession();
  }, [init]);

  // 同步音量增强：启动时套用持久化值，设置页拖动时实时生效。
  // volumeBoost 是百分比（100 = 不增强），增益节点取倍数 = 百分比 / 100。
  useEffect(() => {
    setVolumeBoost((volumeBoost ?? 100) / 100);
  }, [volumeBoost]);

  if (isMobileLayout) {
    return <MobilePlayBar />;
  }

  return (
    <Card
      radius="none"
      shadow="sm"
      className={clx(
        "bg-background grid h-full",
        isTabletLayout
          ? "grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-1 px-2"
          : "grid-cols-[minmax(0,1fr)_minmax(0,3fr)_minmax(0,1fr)] px-4",
      )}
    >
      <div className="h-full">{Boolean(playId) && <Left />}</div>
      <Center />
      <Right />
    </Card>
  );
}

export default PlayBar;
