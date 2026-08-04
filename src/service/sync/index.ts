import { useFavoritesStore } from "@/store/favorite";
import { useLocalFavItemsStore } from "@/store/local-fav-items";
import { useTagStore } from "@/store/tags";
import { useUser } from "@/store/user";

import { watchVersions } from "./client";
import { decodeFavItems, decodeFavorites, decodeTags, encodeFavItems, encodeFavorites, encodeTags } from "./codec";
import { WATCH_RETRY_DELAYS_MS } from "./config";
import { StoreSyncController } from "./engine";

/** zustand persist 暴露的 rehydrate 状态，三个歌单 store 都由 persist 中间件包着 */
type HydratableStore = {
  persist: { hasHydrated: () => boolean; onFinishHydration: (cb: () => void) => () => void };
};

/** 等一组 persist store 全部完成 rehydrate（已完成的直接过） */
function waitHydrated(...stores: HydratableStore[]): Promise<void> {
  const pending = stores.filter(store => !store.persist.hasHydrated());
  if (pending.length === 0) return Promise.resolve();
  return Promise.all(
    pending.map(
      store =>
        new Promise<void>(resolve => {
          const unsub = store.persist.onFinishHydration(() => {
            unsub();
            resolve();
          });
        }),
    ),
  ).then(() => undefined);
}

const favoritesController = new StoreSyncController({
  store: "favorites",
  waitReady: () => waitHydrated(useFavoritesStore),
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
  waitReady: () => waitHydrated(useLocalFavItemsStore),
  encodeNow: () => encodeFavItems(useLocalFavItemsStore.getState().folderItems),
  applyRemote: flat => {
    useLocalFavItemsStore.setState({ folderItems: decodeFavItems(flat) });
  },
});

const tagsController = new StoreSyncController({
  store: "tags",
  waitReady: () => waitHydrated(useTagStore),
  encodeNow: () => encodeTags(useTagStore.getState().tags, useTagStore.getState().itemTags),
  applyRemote: flat => {
    const { tags, itemTags } = decodeTags(flat);
    useTagStore.setState({ tags, itemTags });
  },
});

const allControllers = [favoritesController, favItemsController, tagsController];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 通知通道：一直挂一个请求在服务端，别的设备一改就被唤醒，随即触发一轮同步。
 *
 * 这**不是轮询**——挂起期间一个请求都不发、不占 CPU，服务端有变更才唤醒。之所以要
 * 客户端先"把手举着"，是因为服务端无法主动连接 NAT 后面的客户端，通知必须有一条
 * already-open 的通道才能送达。
 *
 * 起始 `known` 故意留空——第一轮必然立刻返回 `changed: true`，等于"启动/登录后先看看
 * 有没有落下的通知"，有就拉。断线时按 2s→5s→15s→30s 退避重连：瞬断能立刻恢复
 * （否则每次断线都留一个几十秒的通知盲区），服务真挂了也不会空转打请求。
 */
async function startWatchLoop(onChanged: () => void): Promise<void> {
  let known: Record<string, number> = {};
  let failures = 0;

  for (;;) {
    const result = await watchVersions(known).catch(() => null);

    if (!result) {
      await sleep(WATCH_RETRY_DELAYS_MS[Math.min(failures, WATCH_RETRY_DELAYS_MS.length - 1)]);
      failures += 1;
      continue;
    }

    failures = 0;
    known = result.versions;
    if (result.changed) onChanged();
  }
}

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

  // 通知通道：另一台设备一改动，服务端立刻唤醒这里。这是唯一的常驻机制——
  // 没有定时轮询，断线由 startWatchLoop 自己退避重连补齐。
  void startWatchLoop(triggerAll);
  // 系统休眠唤醒后挂着的连接可能已经死了但还没超时，回到前台补一次，成本可忽略
  window.addEventListener("focus", triggerAll);

  // 登录态从无到有时触发一次（涵盖"冷启动时本地已缓存登录态"和"刚登录"两种情况）
  useUser.subscribe((state, prev) => {
    if (state.user?.mid && state.user.mid !== prev.user?.mid) triggerAll();
  });
  if (useUser.getState().user?.mid) triggerAll();
}
