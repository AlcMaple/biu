import Store from "electron-store";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { LIKED_FOLDER_ID, LIKED_FOLDER_TITLE } from "../src/common/constants/heartbeat";
import { encodeFavorites, encodeFavItems, encodeTags } from "../src/service/sync/codec";

import { playlistStoreNames, type PlaylistStoreName, StoreNameMap } from "@shared/store";
import type { FavoriteItem } from "../src/store/favorite";
import type { LocalFavItem, ReplaceLog } from "../src/store/local-fav-items";
import type { Tag } from "../src/store/tags";

interface PlaylistFiles {
  createdFavorites?: FavoriteItem[];
  createdOrder?: number[];
  collectedOrder?: number[];
  folderItems?: Record<string, LocalFavItem[]>;
  replaceLogs?: Record<string, ReplaceLog[]>;
  tags?: Tag[];
  itemTags?: Record<string, number[]>;
}

function mergeList<T>(current: T[] = [], legacy: T[] = [], id: (item: T) => string | number): T[] {
  if (!Array.isArray(current) || !Array.isArray(legacy)) throw new Error("歌单文件中的列表格式无效");
  const seen = new Set(current.map(id));
  const result = [...current];
  for (const item of legacy) {
    const key = id(item);
    if (!seen.has(key)) {
      result.push(item);
      seen.add(key);
    }
  }
  return result;
}

function mergeGroups<T>(
  current: Record<string, T[]> = {},
  legacy: Record<string, T[]> = {},
  id: (item: T) => string | number,
) {
  const result = { ...current };
  for (const [key, items] of Object.entries(legacy)) result[key] = mergeList(current[key], items, id);
  return result;
}

function mergeLegacy(name: PlaylistStoreName, current: PlaylistFiles, legacy: PlaylistFiles): PlaylistFiles {
  const merged = { ...legacy, ...current };
  switch (name) {
    case StoreNameMap.LocalFavorites: {
      const oldLiked = legacy.createdFavorites?.find(folder => folder.id === LIKED_FOLDER_ID && folder.isLocal);
      const currentFolders = current.createdFavorites?.map(folder =>
        folder.id === LIKED_FOLDER_ID && oldLiked
          ? {
              ...folder,
              title: folder.title === LIKED_FOLDER_TITLE ? oldLiked.title : folder.title,
              cover: folder.cover || oldLiked.cover,
              intro: folder.intro || oldLiked.intro,
            }
          : folder,
      );
      return {
        ...merged,
        createdFavorites: mergeList(
          currentFolders,
          legacy.createdFavorites?.filter(f => f.isLocal),
          f => f.id,
        ),
        createdOrder: mergeList(current.createdOrder, legacy.createdOrder, id => id),
        collectedOrder: mergeList(current.collectedOrder, legacy.collectedOrder, id => id),
      };
    }
    case StoreNameMap.LocalFavItems:
      return {
        ...merged,
        folderItems: mergeGroups(current.folderItems, legacy.folderItems, i => String(i.rid)),
        replaceLogs: mergeGroups(current.replaceLogs, legacy.replaceLogs, log => log.id),
      };
    case StoreNameMap.Tags:
      return {
        ...merged,
        tags: mergeList(current.tags, legacy.tags, t => t.id),
        itemTags: mergeGroups(current.itemTags, legacy.itemTags, id => id),
      };
  }
}

export class DesktopPlaylistAccounts {
  private migration: Store<{ owner: number | null; completed: boolean }>;
  private stores = new Map<string, Store<PlaylistFiles>>();

  constructor(
    private root: string,
    readHistory: () => { owners: number[]; meta: PlaylistSyncMetaData },
  ) {
    this.migration = new Store({ cwd: root, name: "playlist-upgrade-2.8" });
    if (this.migration.has("owner")) return;
    const folders = this.open(root, StoreNameMap.LocalFavorites).store;
    const songs = this.open(root, StoreNameMap.LocalFavItems).store;
    const tags = this.open(root, StoreNameMap.Tags).store;
    const hasLegacy =
      folders.createdFavorites?.some(
        f => f.isLocal && (f.id !== LIKED_FOLDER_ID || f.title !== LIKED_FOLDER_TITLE || f.cover || f.intro),
      ) ||
      Object.values(songs.folderItems ?? {}).some(items => items.length) ||
      Object.keys(songs.replaceLogs ?? {}).length ||
      tags.tags?.length ||
      Object.keys(tags.itemTags ?? {}).length;
    if (!hasLegacy) {
      this.migration.store = { owner: null, completed: true };
      return;
    }
    const { owners, meta } = readHistory();
    const known = [...new Set(owners.filter(mid => Number.isSafeInteger(mid) && mid > 0))];
    // 上次登录的 UID 只能说明谁最后用过这台电脑。未同步的歌曲也可能是游客或另一个账号留下的。
    const soleMid = known.length === 1 ? known[0] : undefined;
    const snapshots = soleMid ? meta[String(soleMid)]?.snapshots : undefined;
    const entries = {
      favorites: encodeFavorites(folders.createdFavorites ?? []),
      "fav-items": encodeFavItems(songs.folderItems ?? {}),
      tags: encodeTags(tags.tags ?? [], tags.itemTags ?? {}),
    };
    const verified =
      snapshots &&
      !Object.values(songs.replaceLogs ?? {}).some(logs => logs.length) &&
      Object.entries(entries).every(([store, values]) =>
        Object.entries(values).every(([key, entry]) => {
          const saved = snapshots[store]?.[key];
          return (
            saved && typeof saved === "object" && "payload" in saved && isDeepStrictEqual(saved.payload, entry.payload)
          );
        }),
      );
    this.migration.store = { owner: verified && soleMid ? soleMid : null, completed: false };
  }

  private open(cwd: string, name: PlaylistStoreName) {
    const key = path.join(cwd, name);
    let store = this.stores.get(key);
    if (!store) {
      store = new Store<PlaylistFiles>({ cwd, name });
      this.stores.set(key, store);
    }
    return store;
  }

  accountStore(mid: number, name: PlaylistStoreName) {
    if (!Number.isSafeInteger(mid) || mid <= 0) throw new Error("无效的歌单账号");
    return this.open(path.join(this.root, "accounts", String(mid)), name);
  }

  prepare(mid: number, claim = false): boolean {
    let { owner, completed } = this.migration.store;
    if (claim && owner !== null && owner !== mid) throw new Error("旧歌单已归属其他账号");
    if (completed) return false;
    if (claim && owner === null) {
      // 先锁定认领人。中途退出后只允许同一账号补全三个文件，重复合并按 ID 去重。
      this.migration.set("owner", mid);
      owner = mid;
    }
    if (owner !== mid) return owner === null;
    for (const name of playlistStoreNames) {
      const target = this.accountStore(mid, name);
      target.store = mergeLegacy(name, target.store, this.open(this.root, name).store);
    }
    this.migration.set("completed", true);
    return false;
  }
}
