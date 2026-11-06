import { LIKED_FOLDER_ID, LIKED_FOLDER_TITLE } from "@/common/constants/heartbeat";
import { getItemTagKey } from "@/common/utils/item-identity";

import type { PlaylistPartitionData } from "./web-playlist-partition";

export function mergeLegacyPlaylists(current: PlaylistPartitionData, legacy: PlaylistPartitionData) {
  const data = structuredClone(current);
  const source = structuredClone(legacy);
  // 旧版type12可能是本地文件或在线音频，缺少来源时不猜测资源身份。
  for (const item of [
    ...Object.values(data.items.folderItems).flat(),
    ...Object.values(source.items.folderItems).flat(),
  ]) {
    if (item.type === 12 && item.source === undefined && !item.ownerMid && !item.ownerName)
      throw new Error("旧音频来源不明确，原件已保留");
  }
  const folderIds: Record<number, number> = { [LIKED_FOLDER_ID]: LIKED_FOLDER_ID };
  const occupied = new Set([
    ...data.favorites.createdFavorites.map(folder => folder.id),
    ...Object.keys(data.items.folderItems).map(Number),
    ...source.favorites.createdFavorites.map(folder => folder.id),
  ]);
  // 沿用现有时间戳标识约定，避免不同设备每次恢复都从同一个小整数开始碰撞。
  let nextFolder = -Math.max(2, Date.now());
  const targetFolders = new Set([
    ...data.favorites.createdFavorites.map(folder => folder.id),
    ...Object.keys(data.items.folderItems).map(Number),
  ]);
  for (const folder of source.favorites.createdFavorites) {
    let id = folder.id;
    if (folder.title === LIKED_FOLDER_TITLE) id = LIKED_FOLDER_ID;
    else if (id !== LIKED_FOLDER_ID && targetFolders.has(id)) {
      while (occupied.has(nextFolder)) nextFolder--;
      if (!Number.isSafeInteger(nextFolder)) throw new Error("歌单标识空间不足，原件已保留");
      id = nextFolder--;
      occupied.add(id);
    }
    folderIds[folder.id] = id;
    if (!data.favorites.createdFavorites.some(existing => existing.id === id))
      data.favorites.createdFavorites.push({ ...folder, id });
  }
  const currentRids = new Map<string, Set<string>>();
  const knownCurrentRids = new Set<string>();
  for (const item of Object.values(data.items.folderItems).flat()) {
    const key = getItemTagKey(item);
    const rids = currentRids.get(key) ?? new Set<string>();
    rids.add(String(item.rid));
    knownCurrentRids.add(String(item.rid));
    currentRids.set(key, rids);
  }
  for (const key of Object.keys(data.tags.itemTags)) {
    if (!/^(video|audio|local|type):/.test(key) && !knownCurrentRids.has(key))
      throw new Error("当前旧标签缺少资源身份，原件已保留");
  }
  const bareResources = new Map<string, Set<string>>();
  for (const item of Object.values(source.items.folderItems).flat()) {
    const key = String(item.rid);
    const identities = bareResources.get(key) ?? new Set<string>();
    identities.add(getItemTagKey(item));
    bareResources.set(key, identities);
  }
  for (const oldId of new Set([...Object.keys(source.items.folderItems), ...Object.keys(source.items.replaceLogs)])) {
    const items = source.items.folderItems[Number(oldId)] ?? [];
    const id = folderIds[Number(oldId)];
    if (id === undefined) throw new Error("旧歌单缺少映射，原件已保留");
    const target = data.items.folderItems[id] ?? [];
    const seen = new Set(target.map(getItemTagKey));
    for (const item of items) {
      const key = getItemTagKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        target.push(item);
      }
    }
    data.items.folderItems[id] = target;
    const logs = data.items.replaceLogs[id] ?? [];
    const knownLogs = new Set(logs.map(log => log.id));
    for (const log of source.items.replaceLogs[Number(oldId)] ?? []) {
      if (!log || typeof log.id !== "string" || !log.original) throw new Error("旧版处理记录异常，原件已保留");
      if (!knownLogs.has(log.id)) {
        knownLogs.add(log.id);
        logs.push(log);
      }
    }
    if (logs.length) data.items.replaceLogs[id] = logs;
  }
  data.favorites.createdOrder = [
    ...new Set([
      ...data.favorites.createdOrder,
      ...source.favorites.createdOrder.map(id => folderIds[id]).filter(id => id !== undefined),
      ...source.favorites.createdFavorites.map(folder => folderIds[folder.id]),
    ]),
  ];
  const tagIds: Record<number, number> = {};
  const occupiedTags = new Set(data.tags.tags.map(tag => tag.id));
  let nextTag = Math.max(1, Date.now());
  for (const tag of source.tags.tags) {
    const same = data.tags.tags.find(existing => existing.name === tag.name && existing.color === tag.color);
    let id = same?.id ?? tag.id;
    if (!same && occupiedTags.has(id)) {
      while (occupiedTags.has(nextTag)) nextTag++;
      if (!Number.isSafeInteger(nextTag)) throw new Error("标签标识空间不足，原件已保留");
      id = nextTag++;
    }
    tagIds[tag.id] = id;
    if (!same) {
      data.tags.tags.push({ ...tag, id });
      occupiedTags.add(id);
    }
  }
  for (const [oldKey, ids] of Object.entries(source.tags.itemTags)) {
    const keys = /^(video|audio|local|type):/.test(oldKey) ? [oldKey] : [...(bareResources.get(oldKey) ?? [])];
    if (!keys.length) throw new Error("旧标签缺少资源身份，原件已保留");
    const mapped = ids.map(id => {
      if (tagIds[id] === undefined) throw new Error("旧标签定义缺失，原件已保留");
      return tagIds[id];
    });
    // 关联追加而不删除当前分类；旧裸rid只落到明确的资源身份，不扩散到其他媒体类型。
    for (const key of keys) {
      const currentIds =
        data.tags.itemTags[key] ?? [...(currentRids.get(key) ?? [])].flatMap(rid => data.tags.itemTags[rid] ?? []);
      data.tags.itemTags[key] = [...new Set([...currentIds, ...mapped])];
    }
  }
  return { data, folderIds, tagIds };
}
