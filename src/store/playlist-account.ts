import { isOfflineDemo } from "@/common/offline-demo";
import { isWeb, log } from "@/platform";
import { setWebPlaylistOwner } from "@/platform/web";

import { ensureLikedFolder, useFavoritesStore } from "./favorite";
import { useLocalFavItemsStore } from "./local-fav-items";
import { useTagStore } from "./tags";
import { useUser } from "./user";

const playlistStores = [useFavoritesStore, useLocalFavItemsStore, useTagStore] as const;
let currentOwner: number | null = null;
let generation = 0;

// 网页版本地歌单跟着登录账号走。顺序不能换：先把 owner 置空再清内存，
// 清内存触发的写盘才会被丢弃；然后切到新账号重读。反过来会把上一个账号
// 还在内存里的歌单、或者清空后的空歌单，写进新账号。
export async function switchPlaylistAccount(mid: number | null): Promise<void> {
  if (!isWeb || isOfflineDemo || mid === currentOwner) return;
  currentOwner = mid;
  const token = ++generation;

  setWebPlaylistOwner(null);
  useFavoritesStore.setState(useFavoritesStore.getInitialState(), true);
  useLocalFavItemsStore.setState(useLocalFavItemsStore.getInitialState(), true);
  useTagStore.setState(useTagStore.getInitialState(), true);
  setWebPlaylistOwner(mid);

  try {
    await Promise.all(playlistStores.map(store => store.persist.rehydrate()));
  } catch (error) {
    log.error("[playlist-account] 读取账号歌单失败", error);
    return;
  }
  if (token === generation && mid !== null) ensureLikedFolder();
}

useUser.subscribe((state, prev) => {
  if (state.user?.mid !== prev.user?.mid) void switchPlaylistAccount(state.user?.mid ?? null);
});
void switchPlaylistAccount(useUser.getState().user?.mid ?? null);
