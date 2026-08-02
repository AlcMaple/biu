/**
 * 三个本地歌单 store 的数据结构和同步协议要求的"扁平 id -> entry"结构不一样，
 * 这里做双向转换。每个 store 的 encode/decode 必须互为逆操作（decode(encode(x)) 语义上等价于 x）。
 */
import type { FavoriteItem } from "@/store/favorite";
import type { LocalFavItem } from "@/store/local-fav-items";
import type { Tag } from "@/store/tags";

import type { FlatSnapshot, LiveSnapshot, StoreEntry, SyncOp } from "./types";

function liveEntries(flat: FlatSnapshot): [string, unknown][] {
  return Object.entries(flat)
    .filter((entry): entry is [string, StoreEntry & { __deleted?: false }] => !entry[1].__deleted)
    .map(([id, entry]) => [id, entry.payload]);
}

// ── favorites：本地创建的歌单夹（folder id -> FavoriteItem） ──
// 注意：createdOrder / collectedOrder（排序）不参与同步，各设备独立排序，
// 避免为了排序这种低风险数据引入额外的合并复杂度（见 docs/ideas/004）。

export function encodeFavorites(createdFavorites: FavoriteItem[]): LiveSnapshot {
  const flat: LiveSnapshot = {};
  for (const item of createdFavorites) {
    if (!item.isLocal) continue;
    flat[String(item.id)] = { updatedAt: 0, payload: item };
  }
  return flat;
}

export function decodeFavorites(flat: FlatSnapshot): FavoriteItem[] {
  return liveEntries(flat).map(([, payload]) => payload as FavoriteItem);
}

// ── fav-items：各歌单夹内的歌曲（`${folderId}:${rid}` -> LocalFavItem） ──

interface FavItemPayload {
  folderId: number;
  item: LocalFavItem;
}

export function encodeFavItems(folderItems: Record<number, LocalFavItem[]>): LiveSnapshot {
  const flat: LiveSnapshot = {};
  for (const [folderIdStr, items] of Object.entries(folderItems)) {
    const folderId = Number(folderIdStr);
    for (const item of items) {
      const id = `${folderId}:${item.rid}`;
      flat[id] = { updatedAt: 0, payload: { folderId, item } satisfies FavItemPayload };
    }
  }
  return flat;
}

export function decodeFavItems(flat: FlatSnapshot): Record<number, LocalFavItem[]> {
  const folderItems: Record<number, LocalFavItem[]> = {};
  for (const [, payload] of liveEntries(flat)) {
    const { folderId, item } = payload as FavItemPayload;
    (folderItems[folderId] ??= []).push(item);
  }
  return folderItems;
}

// ── tags：标签定义（`tag:{id}`）+ 条目打标（`item:{rid}`）两个 id 空间前缀区分 ──

const TAG_PREFIX = "tag:";
const ITEM_PREFIX = "item:";

export function encodeTags(tags: Tag[], itemTags: Record<string, number[]>): LiveSnapshot {
  const flat: LiveSnapshot = {};
  for (const tag of tags) {
    flat[`${TAG_PREFIX}${tag.id}`] = { updatedAt: 0, payload: tag };
  }
  for (const [rid, tagIds] of Object.entries(itemTags)) {
    flat[`${ITEM_PREFIX}${rid}`] = { updatedAt: 0, payload: tagIds };
  }
  return flat;
}

export function decodeTags(flat: FlatSnapshot): { tags: Tag[]; itemTags: Record<string, number[]> } {
  const tags: Tag[] = [];
  const itemTags: Record<string, number[]> = {};
  for (const [id, payload] of liveEntries(flat)) {
    if (id.startsWith(TAG_PREFIX)) {
      tags.push(payload as Tag);
    } else if (id.startsWith(ITEM_PREFIX)) {
      itemTags[id.slice(ITEM_PREFIX.length)] = payload as number[];
    }
  }
  return { tags, itemTags };
}

// ── 通用 diff：拿两份扁平快照算出要推送的操作序列 ──

/**
 * @param prev 基线快照（上次成功同步后的状态，来自 sync-meta；首次同步时传 {}）
 * @param next 当前本地实时状态 encode 出来的快照
 */
export function diffSnapshots(prev: FlatSnapshot, next: LiveSnapshot, now: number): SyncOp[] {
  const ops: SyncOp[] = [];

  for (const [id, entry] of Object.entries(next)) {
    const prevEntry = prev[id];
    if (!prevEntry || prevEntry.__deleted || JSON.stringify(prevEntry.payload) !== JSON.stringify(entry.payload)) {
      ops.push({ type: "upsert", id, payload: entry.payload, updatedAt: now });
    }
  }

  for (const id of Object.keys(prev)) {
    if (!(id in next) && !prev[id].__deleted) {
      ops.push({ type: "remove", id, updatedAt: now });
    }
  }

  return ops;
}

/**
 * 首次迁移专用 diff：只产生 upsert，绝不产生 remove。
 *
 * Why: 首次同步时 `next`（本地现状）和 `prev`（云端现状）分别可能各自缺一部分——
 * 云端为空是"这是这台设备第一次同步"，本地缺失是"另一台设备已经同步过、这台还没见过"。
 * 两种情况都不能被解读成"删除"，否则老用户数据或者别的设备已同步的数据会被冲掉。
 */
export function diffForMigration(remote: FlatSnapshot, local: LiveSnapshot, now: number): SyncOp[] {
  const ops: SyncOp[] = [];
  for (const [id, entry] of Object.entries(local)) {
    const remoteEntry = remote[id];
    if (
      !remoteEntry ||
      remoteEntry.__deleted ||
      JSON.stringify(remoteEntry.payload) !== JSON.stringify(entry.payload)
    ) {
      ops.push({ type: "upsert", id, payload: entry.payload, updatedAt: now });
    }
  }
  return ops;
}
