import { log } from "@/platform";
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
async function startWatchLoop(onChanged: (versions: Record<string, number>) => void): Promise<void> {
  let known: Record<string, number> = {};
  let failures = 0;

  log.info("[sync/watch] 通知通道启动");

  for (;;) {
    const startedAt = Date.now();
    // 失败必须留痕：这条通道是跨设备实时的唯一来源，静默吞掉异常的话，
    // 它挂了在日志上完全看不出来，只能看到"同步很慢"这种没法排查的现象。
    const result = await watchVersions(known).catch(err => {
      log.warn(`[sync/watch] 请求失败（挂了 ${Date.now() - startedAt}ms，第 ${failures + 1} 次）`, err);
      return null;
    });

    if (!result) {
      const delay = WATCH_RETRY_DELAYS_MS[Math.min(failures, WATCH_RETRY_DELAYS_MS.length - 1)];
      log.warn(`[sync/watch] ${delay}ms 后重连`);
      await sleep(delay);
      failures += 1;
      continue;
    }

    if (failures > 0) log.info(`[sync/watch] 已恢复（之前失败 ${failures} 次）`);
    failures = 0;

    const changedStores = Object.keys(result.versions).filter(store => known[store] !== result.versions[store]);
    known = result.versions;

    log.info(
      `[sync/watch] 挂起 ${Date.now() - startedAt}ms 后返回 changed=${result.changed} 变化的 store=[${changedStores.join(",")}]`,
    );
    // 把版本号一起交给控制器：它据此判断"要不要拉"和"是不是自己造成的回声"，
    // 这两个判断各省掉一个请求
    if (result.changed) onChanged(result.versions);
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

  // 注意判空：applyRemote 写回本地时也会触发订阅，那轮数据刚从服务端拿到，
  // 再同步一次是纯空转，而且会让每次变更的请求量翻倍（撞限流的主因之一）。
  useFavoritesStore.subscribe((state, prev) => {
    if (state.createdFavorites !== prev.createdFavorites && !favoritesController.isApplyingRemote()) {
      favoritesController.scheduleSync();
    }
  });
  useLocalFavItemsStore.subscribe((state, prev) => {
    if (state.folderItems !== prev.folderItems && !favItemsController.isApplyingRemote()) {
      favItemsController.scheduleSync();
    }
  });
  useTagStore.subscribe((state, prev) => {
    if ((state.tags !== prev.tags || state.itemTags !== prev.itemTags) && !tagsController.isApplyingRemote()) {
      tagsController.scheduleSync();
    }
  });

  // 外部触发（被通知 / 登录 / 回到前台）一律立即同步，不走防抖——防抖是为了合并
  // 用户的连续操作，这些场景没有后续变更要合并，多等一个窗口纯属增加跨设备延迟。
  const syncAllNow = () => allControllers.forEach(controller => controller.syncNow());

  // 通知通道：另一台设备一改动，服务端立刻唤醒这里。这是唯一的常驻机制——
  // 没有定时轮询，断线由 startWatchLoop 自己退避重连补齐。
  //
  // 只叫醒**版本号真的变了**的那个 store：服务端返回的 versions 已经精确告诉我们是谁
  // 变了，无脑三个全跑等于每次通知多打两倍请求，两台设备叠加很容易撞满服务端限流。
  void startWatchLoop(versions => {
    for (const controller of allControllers) {
      const remoteVersion = versions[controller.storeName];
      if (remoteVersion === undefined) continue;
      // 已经同步到这个版本了 = 这条通知是本机自己推送造成的回声，不必再拉
      if (controller.hasSynced(remoteVersion)) continue;
      controller.syncNow(remoteVersion);
    }
  });
  // 系统休眠唤醒后挂着的连接可能已经死了但还没超时，回到前台补一次，成本可忽略
  window.addEventListener("focus", syncAllNow);

  // 登录态从无到有时触发一次（涵盖"冷启动时本地已缓存登录态"和"刚登录"两种情况）
  useUser.subscribe((state, prev) => {
    if (state.user?.mid && state.user.mid !== prev.user?.mid) syncAllNow();
  });
  if (useUser.getState().user?.mid) syncAllNow();
}
