import { RiArrowDownSLine, RiArrowUpSLine } from "@remixicon/react";
import clx from "classnames";

import { useSettings } from "@/store/settings";

import { getMusicListItemGrid } from "./styles";

export type MusicListSortKey = "title" | "playCount" | "time" | "duration";

interface Props {
  className?: string;
  hidePubTime?: boolean;
  timeTitle?: string;
  /** 传入后开启列头排序，仅所列的列可点击 */
  sortable?: MusicListSortKey[];
  sortBy?: MusicListSortKey | null;
  sortDir?: "asc" | "desc";
  onSort?: (key: MusicListSortKey) => void;
}

const MusicListHeader = ({ className, hidePubTime, timeTitle, sortable, sortBy, sortDir, onSort }: Props) => {
  const displayMode = useSettings(state => state.displayMode);
  const isCompact = displayMode === "compact";

  const gridCols = getMusicListItemGrid(isCompact, hidePubTime);

  const renderCell = (key: MusicListSortKey, label: string, align: "left" | "right") => {
    const canSort = sortable?.includes(key);
    const alignCls = align === "right" ? "text-right" : "text-left";

    if (!canSort) return <div className={alignCls}>{label}</div>;

    const active = sortBy === key;
    const ArrowIcon = active && sortDir === "asc" ? RiArrowUpSLine : RiArrowDownSLine;

    return (
      <button
        type="button"
        onClick={() => onSort?.(key)}
        className={clx(
          "group flex w-full cursor-pointer items-center gap-0.5 transition-colors",
          align === "right" ? "justify-end" : "justify-start",
          active ? "text-primary" : "hover:text-default-700",
        )}
      >
        <span>{label}</span>
        <ArrowIcon
          size={14}
          className={clx("transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-60")}
        />
      </button>
    );
  };

  return (
    <div
      className={clx(
        "text-default-500 border-divider mb-2 grid w-full items-center gap-4 border-b text-sm",
        isCompact ? "h-8" : "h-10 px-2",
        gridCols,
        className,
      )}
    >
      <div className="min-w-8 text-center">#</div>
      {renderCell("title", "标题", "left")}
      {isCompact && <div className="text-left">UP</div>}
      {renderCell("playCount", "播放量", "right")}
      {!hidePubTime && renderCell("time", timeTitle || "投稿时间", "right")}
      {renderCell("duration", "时长", "right")}
      <div className="w-8" />
    </div>
  );
};

export default MusicListHeader;
