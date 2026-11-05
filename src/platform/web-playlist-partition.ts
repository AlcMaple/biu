import type { FavoriteItem } from "@/store/favorite";
import type { LocalFavItem, ReplaceLog } from "@/store/local-fav-items";
import type { Tag } from "@/store/tags";

import { LIKED_FOLDER_ID, LIKED_FOLDER_TITLE } from "@/common/constants/heartbeat";
import { getItemTagKey } from "@/common/utils/item-identity";

export type PlaylistScope = "guest" | `account:${number}`;

export function playlistScope(mid: number | null): PlaylistScope {
  if (mid === null) return "guest";
  if (!Number.isSafeInteger(mid) || mid <= 0) throw new Error("账号标识无效");
  return `account:${mid}`;
}

export interface PlaylistPartitionData {
  favorites: { createdFavorites: FavoriteItem[]; createdOrder: number[]; collectedOrder: number[] };
  items: { folderItems: Record<number, LocalFavItem[]>; replaceLogs: Record<number, ReplaceLog[]> };
  tags: { tags: Tag[]; itemTags: Record<string, number[]> };
}

export interface PlaylistPartition {
  schema: 1;
  likedVersion: number;
  data: PlaylistPartitionData;
  guestDecision?: { version: number; choice: "merge" | "keep" };
}

export interface PlaylistPartitionStore {
  read: (scope: PlaylistScope) => Promise<PlaylistPartition | undefined>;
  update: <T>(
    scope: PlaylistScope,
    transform: (current: PlaylistPartition | undefined) => { partition: PlaylistPartition; result: T },
  ) => Promise<T>;
}

interface GuestOffer {
  target: PlaylistScope;
  version: number;
  items: LocalFavItem[];
}

const empty = (): PlaylistPartition => ({
  schema: 1,
  likedVersion: 0,
  data: {
    favorites: { createdFavorites: [], createdOrder: [], collectedOrder: [] },
    items: { folderItems: {}, replaceLogs: {} },
    tags: { tags: [], itemTags: {} },
  },
});

const liked = (partition: PlaylistPartition) => partition.data.items.folderItems[LIKED_FOLDER_ID] ?? [];

export function createPlaylistSession(store: PlaylistPartitionStore, scope: PlaylistScope) {
  if (scope !== "guest" && playlistScope(Number(scope.slice("account:".length))) !== scope) {
    throw new Error("账号分区无效");
  }
  let active = true;
  const assertActive = () => {
    if (!active) throw new Error("会话已切换，原操作已停止");
  };
  const readPartition = async (target: PlaylistScope) => {
    assertActive();
    const partition = (await store.read(target)) ?? empty();
    assertActive();
    return structuredClone(partition);
  };

  return {
    scope,
    close: () => (active = false),
    read: async () => (await readPartition(scope)).data,
    write: async <K extends keyof PlaylistPartitionData>(name: K, value: PlaylistPartitionData[K]) => {
      assertActive();
      const copy = structuredClone(value);
      await store.update(scope, current => {
        assertActive();
        const partition = structuredClone(current ?? empty());
        const before = JSON.stringify(liked(partition));
        partition.data[name] = copy;
        if (before !== JSON.stringify(liked(partition))) partition.likedVersion += 1;
        return { partition, result: undefined };
      });
      assertActive();
    },
    guestOffer: async (): Promise<GuestOffer | null> => {
      if (scope === "guest") return null;
      const guest = await readPartition("guest");
      if (!liked(guest).length) return null;
      const account = await readPartition(scope);
      if (account.guestDecision?.version === guest.likedVersion) return null;
      return { target: scope, version: guest.likedVersion, items: liked(guest) };
    },
    decideGuest: async (offer: GuestOffer, choice: "merge" | "keep"): Promise<number> => {
      assertActive();
      if (scope === "guest" || scope !== offer.target) throw new Error("目标账号已变化");
      const snapshot = structuredClone(offer);
      const added = await store.update(scope, current => {
        assertActive();
        const partition = structuredClone(current ?? empty());
        if (partition.guestDecision && partition.guestDecision.version > snapshot.version) {
          throw new Error("访客内容版本已变化，请重新确认");
        }
        if (partition.guestDecision?.version === snapshot.version) return { partition, result: 0 };
        let added = 0;
        if (choice === "merge") {
          const items = [...liked(partition)];
          const seen = new Set(items.map(getItemTagKey));
          for (const item of snapshot.items) {
            const key = getItemTagKey(item);
            if (seen.has(key)) continue;
            seen.add(key);
            items.push(item);
            added += 1;
          }
          partition.data.items.folderItems[LIKED_FOLDER_ID] = items;
          if (added) partition.likedVersion += 1;
          const favorites = partition.data.favorites;
          if (!favorites.createdFavorites.some(folder => folder.id === LIKED_FOLDER_ID)) {
            favorites.createdFavorites.unshift({
              id: LIKED_FOLDER_ID,
              title: LIKED_FOLDER_TITLE,
              isLocal: true,
              isDefault: true,
            });
          }
          if (!favorites.createdOrder.includes(LIKED_FOLDER_ID)) favorites.createdOrder.unshift(LIKED_FOLDER_ID);
        }
        // 歌曲与选择同事务落盘；访客原件始终不动，失败或重复提交都有恢复来源。
        partition.guestDecision = { version: snapshot.version, choice };
        return { partition, result: added };
      });
      assertActive();
      return added;
    },
  };
}

function parsePartition(value: unknown): PlaylistPartition | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) throw new Error("收藏分区损坏，已保留原件");
  const partition = value as Partial<PlaylistPartition>;
  const isMap = (map: unknown) => typeof map === "object" && map !== null && !Array.isArray(map);
  if (
    partition.schema !== 1 ||
    !Number.isSafeInteger(partition.likedVersion) ||
    partition.likedVersion! < 0 ||
    !Array.isArray(partition.data?.favorites?.createdFavorites) ||
    !Array.isArray(partition.data?.favorites?.createdOrder) ||
    !Array.isArray(partition.data?.favorites?.collectedOrder) ||
    !isMap(partition.data?.items?.folderItems) ||
    !isMap(partition.data?.items?.replaceLogs) ||
    !Array.isArray(partition.data?.tags?.tags) ||
    !isMap(partition.data?.tags?.itemTags) ||
    (partition.guestDecision !== undefined &&
      (!Number.isSafeInteger(partition.guestDecision.version) ||
        partition.guestDecision.version < 0 ||
        !["merge", "keep"].includes(partition.guestDecision.choice)))
  ) {
    throw new Error("收藏分区版本或内容异常，已保留原件");
  }
  return partition as PlaylistPartition;
}

export function createIndexedDBPlaylistPartitionStore(database: IDBDatabase, prefix: string): PlaylistPartitionStore {
  const key = (scope: PlaylistScope) => `${prefix}playlist-partition:v1:${scope}`;
  return {
    read: scope =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction("stores", "readonly");
        const request = transaction.objectStore("stores").get(key(scope));
        transaction.oncomplete = () => {
          try {
            resolve(parsePartition(request.result));
          } catch (error) {
            reject(error);
          }
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("收藏读取被中断"));
      }),
    update: (scope, transform) =>
      new Promise((resolve, reject) => {
        // 多标签页也在同一读写事务中取最新值，避免歌曲写入和“不并入”决定互相覆盖。
        const transaction = database.transaction("stores", "readwrite");
        const objectStore = transaction.objectStore("stores");
        const request = objectStore.get(key(scope));
        let result: { value: ReturnType<typeof transform>["result"] } | undefined;
        let cause: unknown;
        request.onsuccess = () => {
          try {
            const next = transform(parsePartition(request.result));
            objectStore.put(next.partition, key(scope));
            result = { value: next.result };
          } catch (error) {
            cause = error;
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          if (result) resolve(result.value);
          else reject(new Error("收藏写入未完成"));
        };
        transaction.onerror = () => reject(cause ?? transaction.error);
        transaction.onabort = () => reject(cause ?? transaction.error ?? new Error("收藏写入被中断"));
      }),
  };
}
