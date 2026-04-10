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
      return;
    }

    // 无论是本地歌曲还是在线歌曲，首先检查是否已在任意本地收藏夹中
    const localFolders = useFavoritesStore.getState().createdFavorites.filter(f => f.isLocal);
    const folderItems = useLocalFavItemsStore.getState().folderItems;
    const targetRid =
      playItem.source === "local"
        ? playItem.id
        : playItem.type === "mv"
          ? playItem.aid || playItem.bvid || playItem.id
          : playItem.sid;

    // 加强判断，兼容播放列表中的 item 可能丢失 aid 的情况，通过 bvid 兜底匹配
    const isInAnyLocalFolder = localFolders.some(f =>
      (folderItems[f.id] ?? []).some(
        i => String(i.rid) === String(targetRid) || (playItem.bvid && i.bvid === playItem.bvid),
      ),
    );

    // 如果此首（无论是本地还是在线资源）被发现存在于本地歌单中，我们直接先行点亮高亮，以实现真正的零延迟视觉效果。
    // 但是不要在这里把 isFav 或 isThumb 强行设置回 false，否则对于那些实际在线收藏/点赞的资源来说，会产生从无高亮到高亮的闪动。
    if (isInAnyLocalFolder) {
      set({ isFav: true });
    }

    // 本地歌曲全部直接根据本地判断，即刻结算并中断后续线上请求
    if (playItem.source === "local") {
      set({ isFav: isInAnyLocalFolder, isThumb: false });
      return;
    }

    if (!user?.isLogin) {
      set({ isFav: isInAnyLocalFolder, isThumb: false });
      return;
    }

    try {
      if (playItem.type === "mv" && playItem.bvid) {
        const res = await getWebInterfaceArchiveRelation({ bvid: playItem.bvid });

        if (res.code === 0) {
          set({ isFav: isInAnyLocalFolder || Boolean(res.data.favorite), isThumb: Boolean(res.data.like) });
        } else {
          // 不再强制重置为 false，仅保底为真正的底层客观依据 isInAnyLocalFolder
          set({ isFav: isInAnyLocalFolder });
        }
      } else if (playItem.type === "audio" && playItem.sid) {
        const res = await getCollResourceCheck({
          rid: playItem.sid,
          type: 12,
        });

        if (res.code === 0) {
          set({ isFav: isInAnyLocalFolder || Boolean(res.data), isThumb: false });
        } else {
          set({ isFav: isInAnyLocalFolder });
        }
      } else {
        set({ isFav: isInAnyLocalFolder });
      }
    } catch {
      set({ isFav: isInAnyLocalFolder });
    }
  },
}));
