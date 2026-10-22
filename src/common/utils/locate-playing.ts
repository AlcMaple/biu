export type LocateResult = { index: number } | { message: string };

interface LocateOptions<T> {
  playItem: unknown;
  /** 歌单里已拿到的全部条目（未经搜索 / 标签筛选） */
  allItems: T[];
  /** 当前列表实际展示的条目 */
  shownItems: T[];
  isCurrent: (item: T) => boolean;
  /** 如「收藏夹」「合集」，用于「不在这个 X 里」的文案 */
  folderLabel: string;
}

export const resolveLocateIndex = <T>({
  playItem,
  allItems,
  shownItems,
  isCurrent,
  folderLabel,
}: LocateOptions<T>): LocateResult => {
  if (!playItem) return { message: "当前没有正在播放的歌曲" };

  const index = shownItems.findIndex(isCurrent);
  if (index >= 0) return { index };

  // 区分「被筛选藏起来了」和「压根不在这个歌单」，两者用户能做的事不同
  if (allItems.some(isCurrent)) return { message: "当前播放的歌曲被搜索或标签筛选隐藏了，清除筛选后再试" };
  return { message: `当前播放的歌曲不在这个${folderLabel}里` };
};
