import { chunk } from "es-toolkit/array";

import { bv2av } from "@/common/utils/bv";
import { getFavResourceIds } from "@/service/fav-resource";
import { getFavResourceInfos, type FavResourceInfo } from "@/service/fav-resource-infos";
import { type LocalFavItem, useLocalFavItemsStore } from "@/store/local-fav-items";

/** 是否个人私密收藏夹 */
export const isPrivateFav = (attr: number) => {
  return (attr & 1) === 1;
};

/** 是否默认收藏夹 */
export const isDefaultFav = (attr?: number) => {
  if (attr === undefined || attr === null) return false;
  return ((attr >> 1) & 1) === 0;
};

/** 本地歌曲（含兼容旧数据：source 字段存入前的本地歌曲没有 source，但也没有 UP 主信息） */
export const isLocalSourceItem = (item: LocalFavItem) =>
  item.source === "local" || (item.type === 12 && !item.ownerMid && !item.ownerName);

/**
 * 批量检测本地收藏夹中 B 站资源的失效状态。
 * - 分集收藏的 rid 是 cid，不能直接查资源接口，统一用 bvid 转 avid 查询（同视频多分集共享检测结果）。
 * - 本地歌曲不参与检测。
 * - 网络失败/接口报错的分片不计入 checked，避免把网络问题误判成失效。
 * @returns checked: 实际完成检测的 rid 集合；invalid: 其中已失效的 rid 集合
 */
export const detectInvalidLocalFavItems = async (items: LocalFavItem[]) => {
  // resource key（"avid:2" / "auid:12"）-> 该资源对应的所有 rid（分集会多对一）
  const resourceToRids = new Map<string, string[]>();
  for (const item of items) {
    if (isLocalSourceItem(item)) continue;
    let key: string | null = null;
    if (item.type === 2) {
      const avid = item.bvid ? bv2av(item.bvid) : Number(item.rid);
      if (Number.isFinite(avid)) key = `${avid}:2`;
    } else if (item.type === 12 && Number.isFinite(Number(item.rid))) {
      key = `${item.rid}:12`;
    }
    if (!key) continue;
    const rids = resourceToRids.get(key) ?? [];
    rids.push(String(item.rid));
    resourceToRids.set(key, rids);
  }

  const checked = new Set<string>();
  const invalid = new Set<string>();
  const chunks = chunk([...resourceToRids.keys()], 50);
  const results = await Promise.allSettled(
    chunks.map(keys => getFavResourceInfos({ resources: keys.join(","), platform: "web" })),
  );

  results.forEach((result, i) => {
    if (result.status !== "fulfilled" || result.value.code !== 0) return;
    // 接口对已删除资源可能直接不返回该条目，因此「不在有效集合里」即视为失效
    const validKeys = new Set(
      (result.value.data ?? []).filter(info => info.attr === 0).map(info => `${info.id}:${info.type}`),
    );
    for (const key of chunks[i]) {
      for (const rid of resourceToRids.get(key) ?? []) {
        checked.add(rid);
        if (!validKeys.has(key)) invalid.add(rid);
      }
    }
  });

  return { checked, invalid };
};

/** 获取本地收藏夹的所有媒体（转为 PlayItem 格式） */
export const getLocalFavMedia = (folderId: number) => {
  const items = useLocalFavItemsStore.getState().getItems(folderId);
  return items
    .filter(item => !item.invalid)
    .map(item => {
      if (item.type === 2) {
        if (!item.bvid) return null;
        return {
          type: "mv" as const,
          bvid: item.bvid,
          title: item.title,
          cover: item.cover,
          ownerMid: item.ownerMid,
          ownerName: item.ownerName,
        };
      }
      return {
        type: "audio" as const,
        sid: Number(item.rid),
        title: item.title,
        cover: item.cover,
        ownerMid: item.ownerMid,
        ownerName: item.ownerName,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
};

export const getAllFavMedia = async ({ id: favFolderId }: { id: string }) => {
  const idsRes = await getFavResourceIds({
    media_id: Number(favFolderId),
    platform: "web",
  });

  if (idsRes.code !== 0 || !idsRes.data) {
    return [];
  }

  const allIds = idsRes.data;
  if (allIds.length === 0) {
    return [];
  }

  const validIds = allIds.filter(item => item.type === 2 || item.type === 12);
  if (validIds.length === 0) {
    return [];
  }

  const chunkSize = 50;
  const chunks = chunk(validIds, chunkSize);
  const results = await Promise.allSettled(
    chunks.map(items => {
      const resources = items.map(item => `${item.id}:${item.type}`).join(",");
      return getFavResourceInfos({ resources, platform: "web" });
    }),
  );

  const allInfos: FavResourceInfo[] = [];

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.code === 0 && result.value.data) {
      allInfos.push(...result.value.data);
    }
  }

  return allInfos
    .filter(item => [2, 12].includes(item.type) && item.attr === 0)
    .map(item => {
      if (item.type === 2) {
        return {
          type: "mv" as const,
          bvid: item.bvid || item.bv_id,
          title: item.title,
          cover: item.cover,
          ownerMid: item.upper?.mid,
          ownerName: item.upper?.name,
        };
      }
      return {
        type: "audio" as const,
        sid: item.id,
        title: item.title,
        cover: item.cover,
        ownerMid: item.upper?.mid,
        ownerName: item.upper?.name,
      };
    });
};
