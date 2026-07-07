import type { ReactNode } from "react";

import { RiPlayFill, RiPlayListAddLine } from "@remixicon/react";

import { CollectionType } from "@/common/constants/collection";
import AsyncButton from "@/components/async-button";
import IconButton from "@/components/icon-button";
import SearchWithSort, { type SearchProps } from "@/components/search-with-sort";

import FavToggle, { type FavToggleProps } from "./fav-toggle";
import Menu, { type MenuProps } from "./menu";

interface Props extends FavToggleProps, SearchProps, MenuProps {
  loading?: boolean;
  onPlayAll: () => void;
  onAddToPlayList: () => void;
  /** 右侧搜索/排序前的附加控件（如标签筛选入口） */
  tagFilter?: ReactNode;
}

const Operations = ({
  loading,
  type,
  mediaCount,
  attr,
  isFavorite,
  isCreatedBySelf,
  onKeywordSearch,
  orderOptions,
  order,
  onOrderChange,
  onToggleFavorite,
  onPlayAll,
  onAddToPlayList,
  onClearInvalid,
  tagFilter,
}: Props) => {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <AsyncButton
          color="primary"
          startContent={<RiPlayFill size={22} />}
          onPress={onPlayAll}
          className="dark:text-black"
        >
          播放全部
        </AsyncButton>
        <IconButton size="md" variant="flat" tooltip="添加到播放列表" onPress={onAddToPlayList}>
          <RiPlayListAddLine size={18} />
        </IconButton>
        {!loading && type !== CollectionType.VideoSeries && isCreatedBySelf !== true && (
          <FavToggle isFavorite={isFavorite} onToggleFavorite={onToggleFavorite} />
        )}
        <Menu
          type={type}
          isCreatedBySelf={isCreatedBySelf}
          mediaCount={mediaCount}
          attr={attr}
          onClearInvalid={onClearInvalid}
        />
      </div>
      <div className="flex items-center space-x-2">
        {tagFilter}
        <SearchWithSort
          onKeywordSearch={onKeywordSearch}
          orderOptions={orderOptions}
          order={order}
          onOrderChange={onOrderChange}
        />
      </div>
    </div>
  );
};

export default Operations;
