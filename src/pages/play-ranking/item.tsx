import { Chip } from "@heroui/react";

import type { PlayRankingItem } from "@/store/play-ranking";

import { openBiliVideoLink } from "@/common/utils/url";
import Image from "@/components/image";

interface Props {
  rank: number;
  item: PlayRankingItem;
}

const RankBadge = ({ rank }: { rank: number }) => {
  const isTop3 = rank <= 3;
  const colorClass =
    rank === 1
      ? "text-warning"
      : rank === 2
        ? "text-default-400"
        : rank === 3
          ? "text-amber-700"
          : "text-foreground-500";
  return (
    <div
      className={`w-6 flex-none text-center text-sm font-semibold tabular-nums ${isTop3 ? colorClass : "text-foreground-500"}`}
    >
      {rank}
    </div>
  );
};

const PlayRankingItemRow = ({ rank, item }: Props) => {
  const handlePress = () => {
    if (item.bvid) {
      openBiliVideoLink({ type: "mv", bvid: item.bvid });
    }
  };

  return (
    <div
      className="hover:bg-content2 flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2"
      onClick={item.bvid ? handlePress : undefined}
      role={item.bvid ? "button" : undefined}
    >
      <RankBadge rank={rank} />

      <Image
        removeWrapper
        radius="md"
        src={item.cover}
        width={44}
        height={44}
        className="m-0 flex-none"
        params="760w_428h_1c.avif"
      />

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="w-full truncate text-sm font-medium" title={item.title}>
          {item.title}
        </span>
        <div className="flex min-w-0 items-center gap-1.5">
          {item.isLossless && (
            <Chip size="sm" radius="sm" variant="flat" className="h-auto flex-none px-1.5 py-0.5 text-[10px]">
              无损
            </Chip>
          )}
          {item.isDolby && (
            <Chip size="sm" radius="sm" variant="flat" className="h-auto flex-none px-1.5 py-0.5 text-[10px]">
              杜比
            </Chip>
          )}
          <span className="text-foreground-500 min-w-0 truncate text-xs">{item.ownerName || "-"}</span>
        </div>
      </div>

      <span className="text-foreground-500 flex-none text-xs tabular-nums">播放 {item.periodCount} 次</span>
    </div>
  );
};

export default PlayRankingItemRow;
