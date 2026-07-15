import { MAX_FAV_SEEDS } from "@/common/constants/heartbeat";
import platform from "@/platform";
import { StoreNameMap } from "@shared/store";

/** 一条收藏动作留下的种子（带全元数据 → 能喂私人FM 的全部三腿） */
export interface FavSeed {
  bvid: string;
  title?: string;
  ownerMid?: number;
}

// 进程内缓存，避免每次续供都读一次持久化
let cache: FavSeed[] | null = null;

async function load(): Promise<FavSeed[]> {
  if (cache) return cache;
  try {
    const s = (await platform.getStore(StoreNameMap.HeartbeatFavSeeds)) as { items?: FavSeed[] } | undefined;
    cache = s?.items ?? [];
  } catch {
    cache = [];
  }
  return cache;
}

/**
 * 用户收藏一首歌时调用：把这首歌记进「收藏动作缓冲」，供私人FM 当二度扩展种子。
 * 只认收藏「动作」，不管收进哪个歌单——所以本地歌单和 B站在线收藏夹都能覆盖（在线收藏本地读不到）。
 * 纯本地读写、零网络、零风控。最近的在前，按 bvid 去重，滚动保留最近 MAX_FAV_SEEDS 首。
 */
export async function recordFavoritedSong(seed: FavSeed) {
  if (!seed.bvid) return;
  const list = await load();
  const next = [seed, ...list.filter(s => s.bvid !== seed.bvid)].slice(0, MAX_FAV_SEEDS);
  cache = next;
  void platform.setStore(StoreNameMap.HeartbeatFavSeeds, { items: next });
}

/** 取收藏动作种子（最近的在前） */
export async function getFavSeeds(): Promise<FavSeed[]> {
  return [...(await load())];
}
