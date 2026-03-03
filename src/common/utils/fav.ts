import { chunk } from "es-toolkit/array";

import { getFavResourceIds } from "@/service/fav-resource";
import { getFavResourceInfos, type FavResourceInfo } from "@/service/fav-resource-infos";
import { useLocalFavItemsStore } from "@/store/local-fav-items";

/** 是否个人私密收藏夹 */
export const isPrivateFav = (attr: number) => {
  return (attr & 1) === 1;
};

/** 是否默认收藏夹 */
export const isDefaultFav = (attr?: number) => {
  if (attr === undefined || attr === null) return false;
  return ((attr >> 1) & 1) === 0;
};

/** 获取本地收藏夹的所有媒体（转为 PlayItem 格式） */
export const getLocalFavMedia = (folderId: number) => {
  const items = useLocalFavItemsStore.getState().getItems(folderId);
  return items
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
