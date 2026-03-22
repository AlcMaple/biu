import { create } from "zustand";

import { getCollResourceCheck } from "@/service/medialist-gateway-coll-resource-check";
import { getWebInterfaceArchiveRelation } from "@/service/web-interface-archive-relation";
import { useFavoritesStore } from "@/store/favorite";
import { useLocalFavItemsStore } from "@/store/local-fav-items";
import { usePlayList } from "@/store/play-list";
import { useUser } from "@/store/user";

interface State {
  isThumb: boolean;
  isFav: boolean;
}

interface Action {
  setIsFav: (value: boolean) => void;
  setIsThumb: (value: boolean) => void;
  refreshIsFav: () => Promise<void>;
}

export const useMusicFavStore = create<State & Action>()(set => ({
  isThumb: false,
  isFav: false,
  setIsFav: value => {
    set({ isFav: value });
  },
  setIsThumb: value => {
    set({ isThumb: value });
  },
  refreshIsFav: async () => {
    const user = useUser.getState().user;
    const playItem = usePlayList.getState().getPlayItem();

    if (!playItem) {
      set({ isFav: false, isThumb: false });
      return;
    }

    // 本地歌曲：检查是否已在任意本地收藏夹中
    if (playItem.source === "local") {
      const localFolders = useFavoritesStore.getState().createdFavorites.filter(f => f.isLocal);
      const folderItems = useLocalFavItemsStore.getState().folderItems;
      const isInAnyFolder = localFolders.some(f =>
        (folderItems[f.id] ?? []).some(i => String(i.rid) === String(playItem.id)),
      );
      set({ isFav: isInAnyFolder, isThumb: false });
      return;
    }

    if (!user?.isLogin) {
      set({ isFav: false, isThumb: false });
      return;
    }

    try {
      if (playItem.type === "mv" && playItem.bvid) {
        const res = await getWebInterfaceArchiveRelation({ bvid: playItem.bvid });

        if (res.code === 0) {
          set({ isFav: Boolean(res.data.favorite), isThumb: Boolean(res.data.like) });
        } else {
          set({ isFav: false, isThumb: false });
        }
      } else if (playItem.type === "audio" && playItem.sid) {
        const res = await getCollResourceCheck({
          rid: playItem.sid,
          type: 12,
        });

        if (res.code === 0) {
          set({ isFav: Boolean(res.data), isThumb: false });
        } else {
          set({ isFav: false, isThumb: false });
        }
      } else {
        set({ isFav: false, isThumb: false });
      }
    } catch {
      set({ isFav: false, isThumb: false });
    }
  },
}));
