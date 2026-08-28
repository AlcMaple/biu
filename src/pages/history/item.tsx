import type { ReactNode } from "react";
import { useNavigate } from "react-router";

import { Button } from "@heroui/react";
import clx from "classnames";

import { useLayoutMode } from "@/common/hooks/use-responsive";
import { formatDuration } from "@/common/utils/time";
import ContextMenu, { type ContextMenuItem } from "@/components/context-menu";
import Image from "@/components/image";
import OperationMenu from "@/components/music-list-item/operation";
import { isWeb } from "@/platform";
import { isSame, usePlayList } from "@/store/play-list";

interface Props {
  index: number;
  title: ReactNode;
  cover?: string;
  upName?: string;
  upMid?: number;
  progress?: number;
  duration?: number;
  viewAt?: string;
  bvid?: string;
  type?: "audio" | "mv";
  onPress?: () => void;
  menus: ContextMenuItem[];
  onMenuAction?: (key: string) => void;
  isCompact?: boolean;
}

const HistoryListItem = ({
  index,
  title,
  cover,
  upName,
  upMid,
  progress = 0,
  duration = 0,
  viewAt,
  bvid,
  type = "mv",
  onPress,
  menus,
  onMenuAction,
  isCompact,
}: Props) => {
  const navigate = useNavigate();
  const playId = usePlayList(state => state.playId);
  const list = usePlayList(state => state.list);
  const playItem = list.find(item => item.id === playId);
  const isPlay = isSame(playItem, { type, bvid });
  const mode = useLayoutMode();
  const isMobile = mode === "mobile";
  const isTablet = mode === "tablet" || mode === "narrow-tablet";

  const gridCols = isMobile
    ? "grid-cols-[auto_1fr_auto]"
    : isTablet
      ? "grid-cols-[36px_minmax(0,1fr)_96px_auto]"
      : isCompact
        ? "grid-cols-[40px_1fr_150px_150px_150px_40px]"
        : "grid-cols-[40px_1fr_150px_150px_40px]";

  const formatProgress = (prog: number, dur: number) => {
    const p = formatDuration(prog > 0 ? prog : 0);
    const d = formatDuration(dur > 0 ? dur : 0);
    return `${p} / ${d}`;
  };

  return (
    <ContextMenu items={menus} onAction={onMenuAction}>
      <Button
        as="div"
        fullWidth
        disableAnimation
        variant={isPlay ? "flat" : "light"}
        color={isPlay ? "primary" : "default"}
        onDoubleClick={!isMobile ? onPress : undefined}
        onPress={isMobile ? onPress : undefined}
        className={clx(
          "group flex w-full items-center justify-between rounded-md",
          isMobile
            ? "h-auto min-h-16 min-w-0 px-1 py-2 text-sm"
            : isCompact
              ? "h-9 min-h-9 min-w-0 px-0 text-sm"
              : "h-auto min-h-auto min-w-auto space-y-2 p-2",
        )}
      >
        <div className={clx("grid w-full items-center gap-4", gridCols)}>
          {/* 1. # */}
          <div className="text-foreground-500 text-center text-xs tabular-nums">{index}</div>

          {/* 2. Title (Cover + Title) */}
          <div className="flex min-w-0 items-center overflow-hidden">
            {!isCompact && (
              <div className="relative h-12 w-12 flex-none">
                <Image
                  removeWrapper
                  radius="md"
                  src={cover}
                  width="100%"
                  height="100%"
                  className="m-0"
                  params="760w_428h_1c.avif"
                />
              </div>
            )}
            <div className={clx("flex min-w-0 flex-col items-start justify-center space-y-1", { "ml-2": !isCompact })}>
              <span
                className={clx("w-full truncate text-left text-sm font-medium", {
                  "text-primary": isPlay,
                })}
                title={!isWeb && typeof title === "string" ? title : undefined}
              >
                {title}
              </span>
              {!isCompact && (
                <span
                  className={clx("text-foreground-500 w-fit truncate text-xs", {
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

          {/* 3. UP (Compact only) */}
          {!isMobile && !isTablet && isCompact && (
            <div className="min-w-0 truncate text-left">
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

          {/* 4. Progress/Duration */}
          {!isMobile && (
            <div className="text-foreground-500 text-right text-xs tabular-nums">
              {formatProgress(progress, duration)}
            </div>
          )}

          {/* 5. View Time */}
          {!isMobile && !isTablet && <div className="text-foreground-500 text-right text-xs">{viewAt}</div>}

          {/* 6. Actions */}
          <div className="flex h-full items-center justify-end">
            <OperationMenu items={menus} onAction={onMenuAction} />
          </div>
        </div>
      </Button>
    </ContextMenu>
  );
};

export default HistoryListItem;
