import { Button } from "@heroui/react";
import { RiPauseFill, RiPlayFill } from "@remixicon/react";

import { usePlayList } from "@/store/play-list";

interface Props {
  /** 这一行是否就是当前曲目 */
  isCurrent: boolean;
  /** 播放这一行 */
  onPlay: VoidFunction;
}

/**
 * 列表行尾的单击播放按钮。Web 整行是双击播放，这个按钮提供单击入口；
 * 当前曲目在播时点击切换为暂停。
 *
 * 外层 span 只在冒泡阶段拦截 pointerdown/click，挡住事件冒到整行 Button（避免既播又暂停）；
 * 不能用捕获阶段 stopPropagation，那样事件到不了里面的按钮。
 */
const RowPlayButton = ({ isCurrent, onPlay }: Props) => {
  const isPlaying = usePlayList(state => state.isPlaying);
  const isPlayingThis = isCurrent && isPlaying;

  return (
    <span className="flex flex-none" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <Button
        isIconOnly
        variant={isCurrent ? "flat" : "light"}
        color={isCurrent ? "primary" : "default"}
        size="sm"
        radius="full"
        aria-label={isPlayingThis ? "暂停" : "播放"}
        onPress={() => {
          if (isCurrent) usePlayList.getState().togglePlay();
          else onPlay();
        }}
      >
        {isPlayingThis ? <RiPauseFill size={18} /> : <RiPlayFill size={18} />}
      </Button>
    </span>
  );
};

export default RowPlayButton;
