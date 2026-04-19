import { create } from "zustand";
import { persist } from "zustand/middleware";

import platform from "@/platform";
import { getFavFolderCollectedList } from "@/service/fav-folder-collected-list";
import { getFavFolderCreatedList } from "@/service/fav-folder-created-list";
import { getSpaceNavnum } from "@/service/space-navnum";
import { StoreNameMap } from "@shared/store";

export interface FavoriteItem {
  id: number;
  title: string;
  cover?: string;
  type?: number;
  mid?: number;
  /** 本地创建 */
  isLocal?: boolean;
  intro?: string;
}

interface State {
  createdFavorites: FavoriteItem[];
  collectedFavorites: FavoriteItem[];
  createdOrder: number[];
  collectedOrder: number[];
}

interface Action {
  updateCreatedFavorites: (userMid: number | string) => Promise<void>;
  addCreatedFavorite: (favorite: FavoriteItem) => void;
  rmCreatedFavorite: (id: number) => void;
  modifyCreatedFavorite: (favorite: FavoriteItem) => void;
  reorderCreatedFavorites: (activeId: number, overId: number) => void;
  updateCollectedFavorites: (userMid: number | string) => Promise<void>;
  addCollectedFavorite: (favorite: FavoriteItem) => void;
  rmCollectedFavorite: (id: number) => void;
  reorderCollectedFavorites: (activeId: number, overId: number) => void;
}

const applySavedOrder = <T extends { id: number }>(list: T[], order: number[]) => {
  if (!order.length) {
    return list;
  }

  const orderSet = new Set(order);
  const ordered = order.map(id => list.find(item => item.id === id)).filter((item): item is T => Boolean(item));
  const rest = list.filter(item => !orderSet.has(item.id));

  return [...ordered, ...rest];
};

const reorderList = <T extends { id: number }>(list: T[], activeId: number, overId: number) => {
  const from = list.findIndex(item => item.id === activeId);
  const to = list.findIndex(item => item.id === overId);

  if (from < 0 || to < 0 || from === to) {
    return list;
  }

  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  return next;
};

/**
 * 等待 persist 的 rehydrate 完成。
 *
 * Why: 若 rehydrate 未完成就 merge 远程数据，`createdFavorites` 内存态还是 [],
 * `filter(isLocal)` 取到空数组，会把本地歌单元数据覆盖丢失（真实事故发生过一次）。
 */
const waitForHydration = () =>
  new Promise<void>(resolve => {
    if (useFavoritesStore.persist.hasHydrated()) {
      resolve();
      return;
    }
    const unsub = useFavoritesStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });

export const useFavoritesStore = create<State & Action>()(
  persist(
    (set, get) => ({
      createdFavorites: [],
      collectedFavorites: [],
      createdOrder: [],
      collectedOrder: [],
      updateCreatedFavorites: async (userMid: number | string) => {
        await waitForHydration();

        const result = await getAllCreatedFavorites(userMid);
        // 远程拉取失败时绝不覆写本地状态 —— 避免本地歌单被空数据冲掉
        if (!result.ok) return;

        const localItems = get().createdFavorites.filter(item => item.isLocal);
        const combined = [...localItems, ...result.list];
        const ordered = applySavedOrder(combined, get().createdOrder);

        set(() => ({
          createdFavorites: ordered,
          createdOrder: ordered.map(item => item.id),
        }));
      },
      addCreatedFavorite: (favorite: FavoriteItem) =>
        set(state => {
          const next = [favorite, ...state.createdFavorites];

          return {
            createdFavorites: next,
            createdOrder: next.map(item => item.id),
          };
        }),
      rmCreatedFavorite: (id: number) =>
        set(state => {
          const next = state.createdFavorites.filter(item => item.id !== id);

          return {
            createdFavorites: next,
            createdOrder: next.map(item => item.id),
          };
        }),
      modifyCreatedFavorite: (favorite: FavoriteItem) =>
        set(state => ({
          createdFavorites: state.createdFavorites.map(item =>
            item.id === favorite.id
              ? {
                  ...item,
                  ...favorite,
                }
              : item,
          ),
        })),
      reorderCreatedFavorites: (activeId: number, overId: number) =>
        set(state => {
          const next = reorderList(state.createdFavorites, activeId, overId);

          if (next === state.createdFavorites) {
            return state;
          }

          return {
            createdFavorites: next,
            createdOrder: next.map(item => item.id),
          };
        }),
      updateCollectedFavorites: async (userMid: number | string) => {
        await waitForHydration();

        const result = await getAllCollectedFavorites(userMid);
        if (!result.ok) return;

        const ordered = applySavedOrder(result.list, get().collectedOrder);

        set(() => ({
          collectedFavorites: ordered,
          collectedOrder: ordered.map(item => item.id),
        }));
      },
      addCollectedFavorite: (favorite: FavoriteItem) =>
        set(state => {
          const next = [favorite, ...state.collectedFavorites];

          return {
            collectedFavorites: next,
            collectedOrder: next.map(item => item.id),
          };
        }),
      rmCollectedFavorite: (id: number) =>
        set(state => {
          const next = state.collectedFavorites.filter(item => item.id !== id);

          return {
            collectedFavorites: next,
            collectedOrder: next.map(item => item.id),
          };
        }),
      reorderCollectedFavorites: (activeId: number, overId: number) =>
        set(state => {
          const next = reorderList(state.collectedFavorites, activeId, overId);

          if (next === state.collectedFavorites) {
            return state;
          }

          return {
            collectedFavorites: next,
            collectedOrder: next.map(item => item.id),
          };
        }),
    }),
    {
      name: "favorites-order",
      storage: {
        getItem: async () => {
          const store = await platform.getStore(StoreNameMap.LocalFavorites);
          return store ? { state: store } : null;
        },
        setItem: async (_, value) => {
          if (value.state) {
            await platform.setStore(StoreNameMap.LocalFavorites, value.state);
          }
        },
        removeItem: async () => {
          await platform.clearStore(StoreNameMap.LocalFavorites);
        },
      },
      partialize: state => ({
        createdFavorites: state.createdFavorites.filter(item => item.isLocal),
        createdOrder: state.createdOrder,
        collectedOrder: state.collectedOrder,
      }),
    },
  ),
);

/** 远程拉取结果 —— ok=false 代表请求链路失败，调用方必须拒绝覆写本地状态 */
type FetchResult = { ok: true; list: FavoriteItem[] } | { ok: false };

async function getAllCreatedFavorites(userMid: number | string): Promise<FetchResult> {
  let res: Awaited<ReturnType<typeof getSpaceNavnum>>;
  try {
    res = await getSpaceNavnum({ mid: userMid });
  } catch {
    return { ok: false };
  }

  if (res.code !== 0) {
    return { ok: false };
  }

  const total = res.data?.favourite?.master ?? 0;

  if (!total) {
    return { ok: true, list: [] };
  }

  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  const requests = Array.from({ length: totalPages }, (_, index) =>
    getFavFolderCreatedList({
      up_mid: userMid,
      ps: pageSize,
      pn: index + 1,
    }),
  );

  const results = await Promise.allSettled(requests);

  // 部分成功也视作失败 —— 半截数据合并回本地会丢失缺失页里的歌单
  const anyFailed = results.some(r => r.status === "rejected" || r.value.code !== 0);
  if (anyFailed) {
    return { ok: false };
  }

  const favorites: FavoriteItem[] = [];

  results.forEach(result => {
    if (result.status !== "fulfilled") return;

    const response = result.value;

    if (!response.data?.list?.length) return;

    response.data.list.forEach(item => {
      if (item.state === 0) {
        favorites.push({
          id: item.id,
          title: item.title,
          cover: item.cover,
          type: item.type,
          mid: item.mid,
        });
      }
    });
  });

  return { ok: true, list: favorites };
}

async function getAllCollectedFavorites(userMid: number | string): Promise<FetchResult> {
  const pageSize = 50;

  let firstRes: Awaited<ReturnType<typeof getFavFolderCollectedList>>;
  try {
    firstRes = await getFavFolderCollectedList({
      up_mid: userMid,
      ps: pageSize,
      pn: 1,
      platform: "web",
    });
  } catch {
    return { ok: false };
  }

  if (firstRes.code !== 0 || !firstRes.data) {
    return { ok: false };
  }

  const favorites: FavoriteItem[] = [];

  if (firstRes.data.list?.length) {
    firstRes.data.list.forEach(item => {
      if (item.state === 0) {
        favorites.push({
          id: item.id,
          title: item.title,
          cover: item.cover,
          type: item.type,
          mid: item.mid,
        });
      }
    });
  }

  const total = firstRes.data.count ?? favorites.length;
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) {
    return { ok: true, list: favorites };
  }

  const requests = Array.from({ length: totalPages - 1 }, (_, index) =>
    getFavFolderCollectedList({
      up_mid: userMid,
      ps: pageSize,
      pn: index + 2,
      platform: "web",
    }),
  );

  const results = await Promise.allSettled(requests);

  const anyFailed = results.some(r => r.status === "rejected" || r.value.code !== 0);
  if (anyFailed) {
    return { ok: false };
  }

  results.forEach(result => {
    if (result.status !== "fulfilled") return;

    const response = result.value;

    if (!response.data?.list?.length) return;

    response.data.list.forEach(item => {
      if (item.state === 0) {
        favorites.push({
          id: item.id,
          title: item.title,
          cover: item.cover,
          type: item.type,
          mid: item.mid,
        });
      }
    });
  });

  return { ok: true, list: favorites };
}
