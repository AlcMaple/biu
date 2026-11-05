import type { FavoriteItem } from "@/store/favorite";
import type { LocalFavItem, ReplaceLog } from "@/store/local-fav-items";
import type { Tag } from "@/store/tags";

import { LIKED_FOLDER_ID, LIKED_FOLDER_TITLE } from "@/common/constants/heartbeat";
import { StoreNameMap } from "@shared/store";

import type { PlaylistPartition, PlaylistPartitionData, PlaylistScope } from "./web-playlist-partition";

import { parsePlaylistPartition, webPlaylistPartitionKey } from "./web-playlist-partition";

export const legacyPlaylistNames = [
  StoreNameMap.LocalFavorites,
  StoreNameMap.LocalFavItems,
  StoreNameMap.Tags,
] as const;
type LegacyName = (typeof legacyPlaylistNames)[number];
type LegacyRaw = Record<LegacyName, unknown>;
interface Receipt {
  schema: 1;
  owner: PlaylistScope;
  raw: LegacyRaw;
  at: number;
}
export interface LegacyOffer {
  raw: LegacyRaw;
  songs: number;
  folders: number;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("旧版收藏格式异常，原件已保留");
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("旧版收藏格式异常，原件已保留");
  return value;
}

export function decodeLegacyPlaylists(raw: LegacyRaw): PlaylistPartitionData | null {
  if (legacyPlaylistNames.every(name => raw[name] === undefined || raw[name] === null)) return null;
  const favorites = record(raw[StoreNameMap.LocalFavorites] ?? {});
  const items = record(raw[StoreNameMap.LocalFavItems] ?? {});
  const tags = record(raw[StoreNameMap.Tags] ?? {});
  for (const [value, keys] of [
    [favorites, ["createdFavorites", "createdOrder", "collectedOrder"]],
    [items, ["folderItems", "replaceLogs"]],
    [tags, ["tags", "itemTags"]],
  ] as const) {
    if (Object.keys(value).length && !keys.some(key => key in value)) throw new Error("旧版收藏格式未识别，原件已保留");
  }
  const folders = array(favorites.createdFavorites ?? []);
  for (const folder of folders) {
    const f = record(folder);
    if (!Number.isSafeInteger(f.id) || typeof f.title !== "string" || f.isLocal !== true)
      throw new Error("旧版歌单元数据异常，原件已保留");
  }
  const folderItems = record(items.folderItems ?? {});
  const knownFolders = new Set(folders.map(f => record(f).id));
  for (const [id, values] of Object.entries(folderItems)) {
    if (
      !Number.isSafeInteger(Number(id)) ||
      String(Number(id)) !== id ||
      (!knownFolders.has(Number(id)) && Number(id) !== LIKED_FOLDER_ID)
    )
      throw new Error("旧版歌曲缺少歌单归属，原件已保留");
    for (const value of array(values)) {
      const item = record(value);
      if (
        !["string", "number"].includes(typeof item.rid) ||
        (typeof item.rid === "number" && !Number.isFinite(item.rid)) ||
        typeof item.title !== "string" ||
        !Number.isFinite(item.type) ||
        !Number.isFinite(item.fav_time)
      )
        throw new Error("旧版歌曲格式异常，原件已保留");
    }
  }
  const tagList = array(tags.tags ?? []);
  for (const value of tagList) {
    const tag = record(value);
    if (!Number.isSafeInteger(tag.id) || typeof tag.name !== "string" || typeof tag.color !== "string")
      throw new Error("旧版标签格式异常，原件已保留");
  }
  const order = (value: unknown) =>
    array(value ?? []).map(id => {
      if (!Number.isSafeInteger(id)) throw new Error("旧版歌单顺序异常，原件已保留");
      return id as number;
    });
  const data: PlaylistPartitionData = {
    favorites: {
      createdFavorites: folders as FavoriteItem[],
      createdOrder: order(favorites.createdOrder),
      collectedOrder: order(favorites.collectedOrder),
    },
    items: {
      folderItems: folderItems as Record<number, LocalFavItem[]>,
      replaceLogs: record(items.replaceLogs ?? {}) as Record<number, ReplaceLog[]>,
    },
    tags: { tags: tagList as Tag[], itemTags: record(tags.itemTags ?? {}) as Record<string, number[]> },
  };
  for (const ids of Object.values(data.tags.itemTags))
    if (!Array.isArray(ids) || !ids.every(Number.isSafeInteger)) throw new Error("旧版标签归属异常，原件已保留");
  for (const logs of Object.values(data.items.replaceLogs))
    if (!Array.isArray(logs)) throw new Error("旧版处理记录异常，原件已保留");
  return structuredClone(data);
}

function emptyTarget(partition: PlaylistPartition | undefined) {
  if (!partition) return true;
  const d = partition.data;
  return (
    d.favorites.createdFavorites.every(f => f.id === LIKED_FOLDER_ID && f.title === LIKED_FOLDER_TITLE && !f.cover) &&
    Object.values(d.items.folderItems).every(items => items.length === 0) &&
    Object.values(d.items.replaceLogs).every(logs => logs.length === 0) &&
    d.tags.tags.length === 0 &&
    Object.keys(d.tags.itemTags).length === 0
  );
}

export function planLegacyRecovery(
  target: PlaylistPartition | undefined,
  receipt: Receipt | undefined,
  raw: LegacyRaw,
  scope: PlaylistScope,
) {
  if (receipt) {
    if (receipt.owner === scope) return null;
    throw new Error("旧版收藏已恢复到另一身份，原件已保留");
  }
  if (!emptyTarget(target)) throw new Error("当前身份已有收藏，请先保留旧版原件");
  const data = decodeLegacyPlaylists(raw);
  if (!data) return null;
  return {
    partition: {
      ...target,
      schema: 1 as const,
      likedVersion: data.items.folderItems[LIKED_FOLDER_ID]?.length ? 1 : 0,
      data,
    },
    receipt: { schema: 1 as const, owner: scope, raw: structuredClone(raw), at: Date.now() },
  };
}

export function createLegacyPlaylistRecovery(
  database: IDBDatabase,
  prefix: string,
  scope: PlaylistScope,
  fallback: (name: LegacyName) => unknown,
  checkActive: () => void,
) {
  const receiptKey = `${prefix}playlist-legacy-recovery:v1`;
  const transact = <T>(
    mode: IDBTransactionMode,
    work: (
      store: IDBObjectStore,
      raw: LegacyRaw,
      target: PlaylistPartition | undefined,
      receipt: Receipt | undefined,
    ) => T,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      const tx = database.transaction("stores", mode);
      const store = tx.objectStore("stores");
      const sources = legacyPlaylistNames.map(name => store.get(`${prefix}${name}`));
      const target = store.get(webPlaylistPartitionKey(prefix, scope));
      const receipt = store.get(receiptKey);
      let result: { value: T } | undefined;
      let cause: unknown;
      receipt.onsuccess = () => {
        try {
          checkActive();
          const raw = Object.fromEntries(
            legacyPlaylistNames.map((name, i) => [
              name,
              sources[i].result === undefined ? fallback(name) : sources[i].result,
            ]),
          ) as LegacyRaw;
          const saved = receipt.result as Receipt | undefined;
          if (saved && (saved.schema !== 1 || typeof saved.owner !== "string" || !saved.raw))
            throw new Error("旧版恢复记录异常，原件已保留");
          result = { value: work(store, raw, parsePlaylistPartition(target.result), saved) };
        } catch (error) {
          cause = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => (result ? resolve(result.value) : reject(new Error("旧版恢复事务未完成")));
      tx.onerror = () => reject(cause ?? tx.error);
      tx.onabort = () => reject(cause ?? tx.error ?? new Error("旧版恢复事务已中断"));
    });
  return {
    inspect: () =>
      transact("readonly", (_, raw, _target, receipt): LegacyOffer | null => {
        if (receipt) {
          if (JSON.stringify(receipt.raw) !== JSON.stringify(raw))
            throw new Error("旧版原件在恢复后又有改动，原件已保留");
          return null;
        }
        const data = decodeLegacyPlaylists(raw);
        return data
          ? {
              raw: structuredClone(raw),
              songs: Object.values(data.items.folderItems).reduce((sum, items) => sum + items.length, 0),
              folders: data.favorites.createdFavorites.length,
            }
          : null;
      }),
    recover: (offer: LegacyOffer) =>
      transact("readwrite", (store, raw, target, receipt) => {
        if (JSON.stringify(raw) !== JSON.stringify(offer.raw)) throw new Error("旧版原件已变化，请重新载入后确认");
        const next = planLegacyRecovery(target, receipt, raw, scope);
        if (!next) return false;
        // 归属、原样副本和目标快照一起提交；任一步失败都不删除或改写未分区原件。
        store.put(next.partition, webPlaylistPartitionKey(prefix, scope));
        store.put(next.receipt, receiptKey);
        return true;
      }),
  };
}
