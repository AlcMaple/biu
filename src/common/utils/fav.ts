import { chunk } from "es-toolkit/array";

import { bv2av } from "@/common/utils/bv";
import { resolvePlayCount } from "@/common/utils/number";
import { getFavResourceIds, type FavMedia } from "@/service/fav-resource";
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
 * - 顺带从同一批 infos 响应里取播放量（playByRid），供本地歌单补全「-」用，不额外发请求。
 * @returns checked: 实际完成检测的 rid 集合；invalid: 其中已失效的 rid 集合；playByRid: rid -> 播放量
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
  const playByRid = new Map<string, number>();
  const chunks = chunk([...resourceToRids.keys()], 50);
  const results = await Promise.allSettled(
    chunks.map(keys => getFavResourceInfos({ resources: keys.join(","), platform: "web" })),
  );

  results.forEach((result, i) => {
    if (result.status !== "fulfilled" || result.value.code !== 0) return;
    const infos = result.value.data ?? [];
    // 接口对已删除资源可能直接不返回该条目，因此「不在有效集合里」即视为失效
    const validKeys = new Set(infos.filter(info => info.attr === 0).map(info => `${info.id}:${info.type}`));
    // 资源 -> 播放量（同一资源的所有分集 rid 共享此值）
    const playByKey = new Map<string, number>();
    for (const info of infos) {
      if (info.attr !== 0) continue;
      const play = resolvePlayCount(info.cnt_info?.play, info.cnt_info?.vt);
      if (play > 0) playByKey.set(`${info.id}:${info.type}`, play);
    }
    for (const key of chunks[i]) {
      const play = playByKey.get(key);
      for (const rid of resourceToRids.get(key) ?? []) {
        checked.add(rid);
        if (!validKeys.has(key)) invalid.add(rid);
        if (play !== undefined) playByRid.set(rid, play);
      }
    }
  });

  return { checked, invalid, playByRid };
};

/**
 * 补全收藏夹列表的播放量。
 *
 * B 站列表接口 `/x/v3/fav/resource/list` 对部分视频返回 `cnt_info.play=0`（接口反规范化数据缺失，
 * 并非真实 0 播放，实测同一视频 `/x/v3/fav/resource/infos` 与稿件 stat 都能拿到正确播放量），
 * 导致这些视频在列表里播放量显示为「-」。这里仅对 play / vt 都为 0 的项批量回查 infos 接口补全：
 * - 正常列表：零额外请求；
 * - 存在异常项的页：每页最多触发一次 infos（≤50 个一批），与「打开收藏夹批量查失效」同等量级，不会放大风控。
 */
export const fillFavMediaPlayCount = async (medias: FavMedia[]): Promise<FavMedia[]> => {
  const missing = medias.filter(m => [2, 12].includes(m.type) && !m.cnt_info?.play && !m.cnt_info?.vt);
  if (missing.length === 0) return medias;

  const playMap = new Map<string, number>();
  const chunks = chunk(missing, 50);
  const results = await Promise.allSettled(
    chunks.map(items =>
      getFavResourceInfos({ resources: items.map(m => `${m.id}:${m.type}`).join(","), platform: "web" }),
    ),
  );
  for (const result of results) {
    if (result.status !== "fulfilled" || result.value.code !== 0 || !result.value.data) continue;
    for (const info of result.value.data) {
      // infos 侧同样可能把播放量放在 vt（老视频取 play、新视频取 vt），两者都认
      const play = resolvePlayCount(info.cnt_info?.play, info.cnt_info?.vt);
      if (play > 0) playMap.set(`${info.id}:${info.type}`, play);
    }
  }
  if (playMap.size === 0) return medias;

  return medias.map(m => {
    const play = playMap.get(`${m.id}:${m.type}`);
    return play ? { ...m, cnt_info: { ...m.cnt_info, play } } : m;
  });
};

/**
 * 拉取单个在线收藏项的真实播放量（拿不到返回 0）。
 * type 2 优先用 bvid 转 avid（兼容分集收藏时 rid 为 cid 的情况），type 12 用 rid（auid）。
 */
export const fetchLocalFavPlayCount = async (item: {
  rid: string | number;
  type: number;
  bvid?: string;
}): Promise<number> => {
  let resourceId: number | null = null;
  if (item.type === 2) {
    const avid = item.bvid ? bv2av(item.bvid) : Number(item.rid);
    if (Number.isFinite(avid)) resourceId = avid;
  } else if (item.type === 12 && Number.isFinite(Number(item.rid))) {
    resourceId = Number(item.rid);
  }
  if (resourceId == null) return 0;
  try {
    const res = await getFavResourceInfos({ resources: `${resourceId}:${item.type}`, platform: "web" });
    const info = (res.data ?? []).find(i => i.attr === 0);
    return info ? resolvePlayCount(info.cnt_info?.play, info.cnt_info?.vt) : 0;
  } catch {
    return 0;
  }
};

/**
 * 收藏在线资源到本地歌单：立刻入库（UI 即时响应），若该项没带播放量则**异步回查补上**，
 * 不必等下次重开歌单。播放栏星标 / 心动收藏走的是 `PlayItem`，本身没有播放量字段，
 * 都应经此入口而非直接 `addItem`。回查失败（私密/删除/限流）则保持为空，留待下次打开歌单时兜底补全。
 */
export const addOnlineItemToLocalFav = (folderId: number, item: Omit<LocalFavItem, "fav_time">): void => {
  useLocalFavItemsStore.getState().addItem(folderId, item);
  if (item.playCount || item.source === "local" || ![2, 12].includes(item.type)) return;
  void fetchLocalFavPlayCount(item).then(play => {
    if (play > 0) {
      useLocalFavItemsStore.getState().updatePlayCounts(folderId, new Map([[String(item.rid), play]]));
    }
  });
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
          playCount: item.playCount,
        };
      }
      return {
        type: "audio" as const,
        sid: Number(item.rid),
        title: item.title,
        cover: item.cover,
        ownerMid: item.ownerMid,
        ownerName: item.ownerName,
        playCount: item.playCount,
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
          playCount: resolvePlayCount(item.cnt_info?.play, item.cnt_info?.vt),
        };
      }
      return {
        type: "audio" as const,
        sid: item.id,
        title: item.title,
        cover: item.cover,
        ownerMid: item.upper?.mid,
        ownerName: item.upper?.name,
        playCount: resolvePlayCount(item.cnt_info?.play, item.cnt_info?.vt),
      };
    });
};
