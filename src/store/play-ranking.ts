import { debounce } from "es-toolkit";

import platform from "@/platform";
import { StoreNameMap } from "@shared/store";

import type { PlayData } from "./play-list";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** 时间戳明细只用来算"最近一周"，超过这个窗口的没有意义，裁掉避免数据无限增长 */
const RECENT_PLAYS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_PLAYS_MAX_COUNT = 500;

export interface PlayRankingItem extends PlayCountRecord {
  /** 当前所选周期内的播放次数 */
  periodCount: number;
}

/** 同一首歌在本地统计里的身份键：优先用 bvid/sid + cid 区分分P，本地文件退回 id */
function getPlayCountKey(item: PlayData): string {
  const source = item.source || "online";
  const idPart = item.bvid || (item.sid != null ? String(item.sid) : "") || item.id || "";
  return `${source}:${idPart}:${item.cid || ""}`;
}

let cache: PlayCountsData | null = null;
let loadingPromise: Promise<PlayCountsData> | null = null;

async function loadCache(): Promise<PlayCountsData> {
  if (cache) return cache;
  if (!loadingPromise) {
    loadingPromise = platform.getStore(StoreNameMap.PlayCounts).then(data => {
      cache = data || {};
      return cache!;
    });
  }
  return loadingPromise;
}

const persist = debounce(() => {
  if (cache) void platform.setStore(StoreNameMap.PlayCounts, cache);
}, 1000);

/** 歌曲切换到这首歌时调用一次，累计其播放次数 */
export async function recordPlayCount(item: PlayData): Promise<void> {
  if (!item) return;
  const key = getPlayCountKey(item);
  if (!key || key === "online::") return;

  const data = await loadCache();
  const now = Date.now();
  const prev = data[key];
  const recentPlays = [...(prev?.recentPlays || []), now]
    .filter(t => now - t < RECENT_PLAYS_MAX_AGE_MS)
    .slice(-RECENT_PLAYS_MAX_COUNT);

  data[key] = {
    key,
    title: item.pageTitle || item.title,
    cover: item.pageCover || item.cover,
    ownerName: item.ownerName,
    ownerMid: item.ownerMid,
    bvid: item.bvid,
    isLossless: item.isLossless,
    isDolby: item.isDolby,
    totalCount: (prev?.totalCount || 0) + 1,
    recentPlays,
  };

  persist();
}

/** 获取排行榜数据，period 为 "week" 时只统计最近 7 天 */
export async function getPlayRanking(period: "week" | "all"): Promise<PlayRankingItem[]> {
  const data = await loadCache();
  const now = Date.now();

  return Object.values(data)
    .map(record => ({
      ...record,
      periodCount: period === "all" ? record.totalCount : record.recentPlays.filter(t => now - t < WEEK_MS).length,
    }))
    .filter(item => item.periodCount > 0)
    .sort((a, b) => b.periodCount - a.periodCount);
}
