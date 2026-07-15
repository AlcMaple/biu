import React, { useCallback } from "react";

import { Spinner } from "@heroui/react";

import type { Media } from "@/service/user-video-archives-list";

import { resolvePlayCount } from "@/common/utils/number";
import Empty from "@/components/empty";
import MusicCard from "@/components/music-card";
import VirtualGridPageList from "@/components/virtual-grid-page-list";
import { mediaToPlayItem, playFromFolder } from "@/service/heartbeat/play-from-folder";

import { getContextMenus } from "./menu";

export interface SeriesGridListProps {
  data: Media[];
  loading?: boolean;
  className?: string;
  getScrollElement: () => HTMLElement | null;
  onMenuAction: (key: string, item: Media) => void;
}

const SeriesGridList = ({ data, loading, className, getScrollElement, onMenuAction }: SeriesGridListProps) => {
  const renderGridItem = useCallback(
    (item: Media) => {
      return (
        <MusicCard
          key={item.bvid}
          title={item.title}
          cover={item.cover}
          playCount={resolvePlayCount(item.cnt_info?.play, item.cnt_info?.vt)}
          duration={item.duration}
          ownerName={item.upper?.name}
          ownerMid={item.upper?.mid}
          time={item.pubtime}
          menus={getContextMenus()}
          onMenuAction={key => {
            onMenuAction(key, item);
          }}
          onPress={() => {
            // 从歌单点歌：心动模式进行中则切走 FM、整队替换成本合集；否则常规插播
            playFromFolder(mediaToPlayItem(item), data.map(mediaToPlayItem));
          }}
        />
      );
    },
    [data, onMenuAction],
  );

  if (loading && data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center">
        <Spinner label="加载中" />
      </div>
    );
  }

  if (data.length === 0) {
    return <Empty className="min-h-20" />;
  }

  return (
    <VirtualGridPageList
      items={data}
      itemKey="bvid"
      renderItem={renderGridItem}
      getScrollElement={getScrollElement}
      className={className}
      hasMore={false}
      loading={false}
    />
  );
};

export default SeriesGridList;
