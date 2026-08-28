import clx from "classnames";

import { useLayoutMode } from "@/common/hooks/use-responsive";

interface Props {
  className?: string;
  isCompact?: boolean;
}

const HistoryListHeader = ({ className, isCompact }: Props) => {
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

  return (
    <div
      className={clx(
        "text-default-500 border-default-100 grid w-full items-center gap-4 border-b text-sm",
        isMobile ? "h-10 px-1" : isCompact ? "h-8" : "h-10 px-2",
        gridCols,
        className,
      )}
    >
      <div className="text-center">#</div>
      <div className="text-left">标题</div>
      {!isMobile && !isTablet && isCompact && <div className="text-left">UP</div>}
      {!isMobile && <div className="text-right">播放进度</div>}
      {!isMobile && !isTablet && <div className="text-right">观看时间</div>}
      <div className="w-8" />
    </div>
  );
};

export default HistoryListHeader;
