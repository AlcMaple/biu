import { isOfflineDemo } from "@/common/offline-demo";
import platform, { isWeb, log } from "@/platform";
import { setWebPlaylistOwner } from "@/platform/web";
import { StoreNameMap } from "@shared/store";

import { ensureLikedFolder, useFavoritesStore } from "./favorite";
import { useLocalFavItemsStore } from "./local-fav-items";
import { playlistReadError, usePlaylistSession } from "./playlist-session";
import { useModalStore } from "./modal";
import { useTagStore } from "./tags";
import { useUser } from "./user";

const playlistStores = [useFavoritesStore, useLocalFavItemsStore, useTagStore] as const;

function clearPlaylistMemory() {
  useFavoritesStore.setState(useFavoritesStore.getInitialState(), true);
  useLocalFavItemsStore.setState(useLocalFavItemsStore.getInitialState(), true);
  useTagStore.setState(useTagStore.getInitialState(), true);
}

export async function switchPlaylistAccount(mid: number | null, claim = false): Promise<void> {
  if (isOfflineDemo) return;
  const previous = usePlaylistSession.getState();
  if (claim) {
    if (!mid || previous.mid !== mid || !previous.canClaim || !previous.ready) throw new Error("请重新确认认领账号");
    const meta = await platform.getStore(StoreNameMap.PlaylistSyncMeta);
    if (previous !== usePlaylistSession.getState()) throw new Error("账号已切换，请重新确认认领账号");
    const versions = meta?.[String(mid)]?.versions;
    if (!versions || ["favorites", "fav-items", "tags"].some(name => versions[name] === undefined)) {
      throw new Error("等待此账号完成首次云同步后再认领");
    }
  }
  if (!claim && mid === previous.mid && !previous.error) return;
  usePlaylistSession.setState({ mid, ready: false, canClaim: false, error: "" });
  const loading = usePlaylistSession.getState();
  useModalStore.setState({
    isFavSelectModalOpen: false,
    favSelectModalData: null,
    isConfirmModalOpen: false,
    confirmModalData: null,
  });
  if (isWeb) setWebPlaylistOwner(mid);
  // 切换期间三个 store 均暂停写盘；否则清理内存本身就会覆盖新账号的文件。
  clearPlaylistMemory();
  if (mid === null) return;
  try {
    // useUser 的订阅先于它自己的持久化回调执行，等登录信息发往主进程后再请求账号文件。
    await Promise.resolve();
    if (loading !== usePlaylistSession.getState()) return;
    const canClaim = isWeb ? false : await platform.preparePlaylistAccount(mid, claim);
    if (loading !== usePlaylistSession.getState()) return;
    await Promise.all(playlistStores.map(store => store.persist.rehydrate()));
    if (loading !== usePlaylistSession.getState()) return;
    const readError = playlistReadError(loading);
    if (readError) throw readError;
    if (playlistStores.some(store => !store.persist.hasHydrated()))
      throw new Error("读取歌单文件失败，请检查文件或目录权限");
    usePlaylistSession.setState({ ready: true, canClaim });
    ensureLikedFolder();
  } catch (error) {
    if (loading !== usePlaylistSession.getState()) return;
    clearPlaylistMemory();
    const message = error instanceof Error ? error.message : "读取本地歌单失败";
    usePlaylistSession.setState({ error: message });
    log.error("[playlist-account]", error);
  }
}

export function initPlaylistAccount() {
  const currentMid = () => {
    const user = useUser.getState().user;
    return user?.isLogin && user.mid > 0 ? user.mid : null;
  };
  useUser.subscribe((state, prev) => {
    if (state.user?.mid !== prev.user?.mid || state.user?.isLogin !== prev.user?.isLogin)
      void switchPlaylistAccount(currentMid());
  });
  void switchPlaylistAccount(currentMid());
}
