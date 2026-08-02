import { useFavoritesStore } from "@/store/favorite";
import { useLocalFavItemsStore } from "@/store/local-fav-items";
import { useTagStore } from "@/store/tags";
import { useUser } from "@/store/user";

import { decodeFavItems, decodeFavorites, decodeTags, encodeFavItems, encodeFavorites, encodeTags } from "./codec";
import { StoreSyncController } from "./engine";

const favoritesController = new StoreSyncController({
  store: "favorites",
  encodeNow: () => encodeFavorites(useFavoritesStore.getState().createdFavorites),
  applyRemote: flat => {
    const remoteLocalFolders = decodeFavorites(flat);
    useFavoritesStore.setState(state => {
      const nonLocal = state.createdFavorites.filter(item => !item.isLocal);
      const combined = [...remoteLocalFolders, ...nonLocal];
      // 尽量沿用已有排序，新出现的（比如另一台设备刚建的歌单夹）追加到末尾，
      // 避免每次同步都把用户手动调整过的顺序打乱
      const combinedIds = new Set(combined.map(item => item.id));
      const existingOrder = state.createdOrder.filter(id => combinedIds.has(id));
      const knownIds = new Set(existingOrder);
      const newIds = combined.map(item => item.id).filter(id => !knownIds.has(id));
      return { createdFavorites: combined, createdOrder: [...existingOrder, ...newIds] };
    });
  },
});

const favItemsController = new StoreSyncController({
  store: "fav-items",
  encodeNow: () => encodeFavItems(useLocalFavItemsStore.getState().folderItems),
  applyRemote: flat => {
    useLocalFavItemsStore.setState({ folderItems: decodeFavItems(flat) });
  },
});

const tagsController = new StoreSyncController({
  store: "tags",
  encodeNow: () => encodeTags(useTagStore.getState().tags, useTagStore.getState().itemTags),
  applyRemote: flat => {
    const { tags, itemTags } = decodeTags(flat);
    useTagStore.setState({ tags, itemTags });
  },
});

const allControllers = [favoritesController, favItemsController, tagsController];

let initialized = false;

/**
 * 挂载本地歌单云同步。只应该在主窗口调用一次（见 src/layout/index.tsx）——
 * mini-player / desktop-lyrics 窗口共享同一份渲染 bundle 但不走 Layout，
 * 不会重复触发，不需要额外加窗口判断。
 */
export function initLocalPlaylistSync(): void {
  if (initialized) return;
  initialized = true;

  useFavoritesStore.subscribe((state, prev) => {
    if (state.createdFavorites !== prev.createdFavorites) favoritesController.scheduleSync();
  });
  useLocalFavItemsStore.subscribe((state, prev) => {
    if (state.folderItems !== prev.folderItems) favItemsController.scheduleSync();
  });
  useTagStore.subscribe((state, prev) => {
    if (state.tags !== prev.tags || state.itemTags !== prev.itemTags) tagsController.scheduleSync();
  });

  const triggerAll = () => allControllers.forEach(controller => controller.scheduleSync());

  // 登录态从无到有时触发一次（涵盖"冷启动时本地已缓存登录态"和"刚登录"两种情况）
  useUser.subscribe((state, prev) => {
    if (state.user?.mid && state.user.mid !== prev.user?.mid) triggerAll();
  });
  if (useUser.getState().user?.mid) triggerAll();
}
