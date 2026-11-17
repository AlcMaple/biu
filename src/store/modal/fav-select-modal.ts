import type { ReactNode } from "react";

import type { StateCreator } from "zustand";

import { addToast } from "@heroui/react";

import { isWeb } from "@/platform";
import { useUser } from "@/store/user";

export interface FavSelectModalData {
  /** 资源id */
  rid: string | number;
  /** 2:视频稿件 12:音频 21:视频合集 24:电影/纪录片等 */
  type?: number;
  /** 是否为本地歌曲（跳过 B站 API，仅允许添加到本地收藏夹） */
  isLocal?: boolean;
  /**
   * 是否来自本地歌单中的既有条目。
   * 这类条目已经带有稳定的 rid/cid 和用户自定义标题，移动/复制时直接沿用，不能重新按 B 站稿件选分P。
   */
  fromLocalFavorite?: boolean;
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
    /** 当前正在播放的分集 cid（用于在弹窗中预选该分集） */
    cid?: string;
    /** 当前本地条目的分集序号（来自本地歌单时沿用） */
    page?: number;
    /** 当前本地条目的分集标题（来自本地歌单时沿用） */
    partTitle?: string;
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
  onOpenFavSelectModal: data => {
    // 网页版本地歌单按账号存，未登录时没有可收进去的歌单
    if (isWeb && !useUser.getState().user?.isLogin) {
      addToast({ title: "登录后才能收藏", color: "warning" });
      return;
    }
    set({ isFavSelectModalOpen: true, favSelectModalData: data });
  },
  onFavSelectModalOpenChange: isOpen => set({ isFavSelectModalOpen: isOpen }),
  onCloseFavSelectModal: () => set({ isFavSelectModalOpen: false }),
});
