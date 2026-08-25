import type { ReactNode } from "react";
import { useNavigate } from "react-router";

import { Button } from "@heroui/react";
import { RiPauseFill, RiPlayFill } from "@remixicon/react";
import clx from "classnames";

import { formatNumber } from "@/common/utils/number";
import { formatDuration } from "@/common/utils/time";
import Image from "@/components/image";
import { isWeb } from "@/platform";
import { isSame, usePlayList } from "@/store/play-list";
import { useSettings } from "@/store/settings";

import type { ContextMenuItem } from "../context-menu";

import ContextMenu from "../context-menu";
import OperationMenu from "./operation";
import { useMusicListColumns } from "./styles";

interface Props {
  title: ReactNode;
  type: "audio" | "mv";
  bvid?: string;
  /** 分集 cid（传入后高亮判断会精确匹配分集，避免同视频多集同时高亮） */
  cid?: string;
  sid?: number;
  /** 本地歌曲 id（source=local 时用于判断是否正在播放） */
  itemId?: string;
  source?: "local" | "online";
  cover?: string;
  upName?: string;
  upMid?: number;
  onPress?: () => void;
  playCount?: number;
  duration?: number | string;
  index?: number;
  pubTime?: string;
  menus: ContextMenuItem[];
  onMenuAction?: (key: string) => void;
  hidePubTime?: boolean;
  /** 资源已失效：灰显并展示「失效」角标 */
  invalid?: boolean;
}

const MusicListItem = ({
  title,
  type,
  bvid,
  cid,
  sid,
  itemId,
  source,
  cover,
  upName,
  upMid,
  menus,
  onMenuAction,
  onPress,
  playCount,
  duration,
  index,
  pubTime,
  hidePubTime,
  invalid,
}: Props) => {
  const navigate = useNavigate();
  const playId = usePlayList(state => state.playId);
  const list = usePlayList(state => state.list);
  const isPlaying = usePlayList(state => state.isPlaying);
  const playItem = list.find(item => item.id === playId);
  const isPlay =
    isSame(playItem, { type, bvid, sid, source, id: itemId }) &&
    // 有 cid 时精确匹配分集，防止同视频不同分集同时高亮
    (!cid || !playItem?.cid || cid === playItem.cid);
  /** 当前就是这一行且正在播放：显示暂停图标 */
  const isPlayingThis = isPlay && isPlaying;
  const displayMode = useSettings(state => state.displayMode);
  const isCompact = displayMode === "compact";

  const {
    gridCols,
    isMobile: isMobileLayout,
    showUp,
    showPlayCount,
    showPubTime,
    showDuration,
  } = useMusicListColumns(isCompact, hidePubTime);

  const invalidBadge = invalid && (
    <span className="border-danger/40 text-danger flex-none rounded-sm border px-1 text-[10px] leading-4">失效</span>
  );

  return (
    <ContextMenu items={menus} onAction={onMenuAction}>
      <Button
        as="div"
        radius="md"
        fullWidth
        disableAnimation
        variant={isPlay ? "flat" : "light"}
        color={isPlay ? "primary" : "default"}
        onDoubleClick={!isMobileLayout && !isWeb ? onPress : undefined}
        onPress={isMobileLayout || isWeb ? onPress : undefined}
        className={clx(
          "group flex w-full items-center justify-between rounded-md",
          isCompact ? "h-9 min-h-9 min-w-0 px-0 text-sm" : "h-auto min-h-auto min-w-auto space-y-2 p-2",
        )}
      >
        <div className={clx("grid w-full items-center gap-4", gridCols)}>
          {/* 1. 序号 */}
          <div className="text-foreground-500 min-w-8 text-center text-xs tabular-nums">{index}</div>

          {/* 2. 音乐信息 */}
          {isCompact ? (
            <div className="flex min-w-0 items-center gap-1.5 text-left">
              {invalidBadge}
              <span className={clx("truncate", { "text-primary": isPlay, "text-foreground-400": invalid })}>
                {title}
              </span>
            </div>
          ) : (
            <div className="flex min-w-0 items-center overflow-hidden">
              <div className="relative h-12 w-12 flex-none">
                <Image
                  removeWrapper
                  radius="md"
                  src={cover}
                  width="100%"
                  height="100%"
                  className={clx("m-0", { "opacity-50": invalid })}
                  params="672w_378h_1c.avif"
                />
                {!isPlay && typeof onPress === "function" && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-md bg-[rgba(0,0,0,0.35)] opacity-0 group-hover:opacity-100">
                    <RiPlayFill
                      size={20}
                      className="text-white transition-transform duration-200 group-hover:scale-110"
                    />
                  </div>
                )}
              </div>
              <div className="ml-2 flex min-w-0 flex-col items-start justify-center space-y-1">
                <div className="flex w-full min-w-0 items-center gap-1.5">
                  {invalidBadge}
                  <span
                    className={clx("truncate text-left text-base", {
                      "text-primary": isPlay,
                      "text-foreground-400": invalid,
                    })}
                  >
                    {title}
                  </span>
                </div>
                {Boolean(upName) && (
                  <span
                    className={clx("text-foreground-500 w-fit truncate text-sm", {
                      "cursor-pointer hover:underline": Boolean(upMid),
                    })}
                    onClick={e => {
                      e.stopPropagation();
                      if (!upMid) return;
                      navigate(`/user/${upMid}`);
                    }}
                  >
                    {upName || "未知"}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 3. UP名称 (Compact only) */}
          {isCompact && showUp && (
            <div className="min-w-0 truncate">
              <span
                className={clx("text-foreground-500 w-fit truncate text-sm", {
                  "cursor-pointer hover:underline": Boolean(upMid),
                })}
                onClick={e => {
                  e.stopPropagation();
                  if (!upMid) return;
                  navigate(`/user/${upMid}`);
                }}
              >
                {upName || "未知"}
              </span>
            </div>
          )}

          {/* 4. 播放量 */}
          {showPlayCount && (
            <div className="text-foreground-500 flex justify-end text-xs">
              {playCount !== undefined && playCount > 0 ? formatNumber(playCount) : "-"}
            </div>
          )}

          {/* 5. 投稿时间 */}
          {showPubTime && (
            <div className="text-foreground-500 flex justify-end text-xs">{pubTime && <span>{pubTime}</span>}</div>
          )}

          {/* 6. 时长 */}
          {showDuration && (
            <div className="text-foreground-500 flex justify-end text-xs tabular-nums">
              {Boolean(duration) && <span>{typeof duration === "number" ? formatDuration(duration) : duration}</span>}
            </div>
          )}

          {/* 7. 操作 */}
          <div className="flex h-full items-center justify-end gap-0.5">
            {/* 手机端整行点击的反馈不明显，给每行一个显式播放/暂停按钮：
                当前行在播则点击暂停，否则点击播放；图标随播放状态变化，点了有即时反馈。
                触屏没有 hover，封面上的 ▶ 蒙层用不上，这个按钮才是移动端的主要入口。 */}
            {isMobileLayout && !invalid && typeof onPress === "function" && (
              // 外层 span 只在冒泡阶段拦截，挡住事件继续冒到整行 Button（避免既播又暂停）；
              // 不能用捕获阶段 stopPropagation，那样事件到不了里面的按钮，会导致按钮完全点不动。
              // 按下(pointerdown)也要拦：heroui/react-aria 的 press 是基于 pointerdown 的，
              // 不拦的话整行的 press 仍会被触发。
              <span className="flex" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                <Button
                  isIconOnly
                  variant={isPlay ? "flat" : "light"}
                  color={isPlay ? "primary" : "default"}
                  size="sm"
                  radius="full"
                  aria-label={isPlayingThis ? "暂停" : "播放"}
                  onPress={() => {
                    // 已是当前曲：切换播放/暂停；否则开始播放这一行
                    if (isPlay) usePlayList.getState().togglePlay();
                    else onPress();
                  }}
                >
                  {isPlayingThis ? <RiPauseFill size={18} /> : <RiPlayFill size={18} />}
                </Button>
              </span>
            )}
            {Boolean(menus.length) && <OperationMenu items={menus} onAction={onMenuAction} />}
          </div>
        </div>
      </Button>
    </ContextMenu>
  );
};

export default MusicListItem;
