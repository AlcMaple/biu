import type { PlaylistPartitionData } from "@/platform/web-playlist-partition";

import { useFavoritesStore } from "@/store/favorite";
import { useLocalFavItemsStore } from "@/store/local-fav-items";
import { useTagStore } from "@/store/tags";

export function applyWebPlaylistPartition(data: PlaylistPartitionData) {
  useFavoritesStore.setState(state => {
    // 分区只存本地歌单，不能用再次hydrate把当前账号已加载的在线收藏夹覆盖掉。
    const createdFavorites = [
      ...data.favorites.createdFavorites,
      ...state.createdFavorites.filter(folder => !folder.isLocal),
    ];
    const ids = new Set(createdFavorites.map(folder => folder.id));
    const createdOrder = [...new Set([...data.favorites.createdOrder, ...state.createdOrder, ...ids])].filter(id =>
      ids.has(id),
    );
    return { ...data.favorites, createdFavorites, createdOrder };
  });
  useLocalFavItemsStore.setState(data.items);
  useTagStore.setState(data.tags);
}
