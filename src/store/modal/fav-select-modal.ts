import type { ReactNode } from "react";

import type { StateCreator } from "zustand";

export interface FavSelectModalData {
  /** 资源id */
  rid: string | number;
  /** 2:视频稿件 12:音频 21:视频合集 24:电影/纪录片等 */
  type?: number;
  /** 是否为本地歌曲（跳过 B站 API，仅允许添加到本地收藏夹） */
  isLocal?: boolean;
  title?: ReactNode;
  /** 媒体基本信息，用于保存到本地收藏夹 */
  itemInfo?: {
    title: string;
    cover?: string;
    /** 视频 bvid（type=2 且 online 时用于播放） */
    bvid?: string;
    /** 本地音频文件 URL（source=local 时用于播放） */
    audioUrl?: string;
    /** 来源：local=本地文件 */
    source?: "local" | "online";
    ownerName?: string;
    ownerMid?: number;
    duration?: number | string;
    playCount?: number;
  };
  /** 选择收藏夹后的回调函数, selectedFolderIds 为选中的收藏夹id数组 */
  onSuccess?: (selectedFolderIds: number[]) => void;
}

export interface FavSelectModalState {
  isFavSelectModalOpen: boolean;
  favSelectModalData: FavSelectModalData | null;
  onOpenFavSelectModal: (data: FavSelectModalData) => void;
  onFavSelectModalOpenChange: (isOpen: boolean) => void;
  onCloseFavSelectModal: () => void;
}

export const createFavSelectModalSlice: StateCreator<FavSelectModalState> = set => ({
  isFavSelectModalOpen: false,
  favSelectModalData: null,
  onOpenFavSelectModal: data => set({ isFavSelectModalOpen: true, favSelectModalData: data }),
  onFavSelectModalOpenChange: isOpen => set({ isFavSelectModalOpen: isOpen }),
  onCloseFavSelectModal: () => set({ isFavSelectModalOpen: false }),
});
