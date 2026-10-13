import type { FavMedia } from "@/service/fav-resource";

// 只放内存：收藏夹内容随时会在 B 站侧变化，缓存的作用是「再次打开时立刻有东西看」，
// 每次命中后都会后台向 B 站重新拉一次并对齐，所以不需要落盘，也不用担心跨设备不一致。
const FOLLOWING_PAGE_TTL_MS = 5 * 60 * 1000;
const MAX_PAGES = 200;

export interface FavPageSnapshot {
  hasMore: boolean;
  medias: FavMedia[];
  savedAt: number;
}

const pages = new Map<string, FavPageSnapshot>();
const playCounts = new Map<string, number>();

export const favPageKey = (folderId: string, order: string, keyword: string, page: number) =>
  `${folderId}|${order}|${keyword}|${page}`;

export const favMediaKey = (media: Pick<FavMedia, "id" | "type">) => `${media.id}:${media.type}`;

// 第一页命中后总会后台刷新，可以一直用；后续页不刷新，只在短时间内复用，免得滚到底看到过期内容
export function readFavPage(key: string, page: number) {
  const snapshot = pages.get(key);
  if (!snapshot) return undefined;
  if (page > 1 && Date.now() - snapshot.savedAt > FOLLOWING_PAGE_TTL_MS) {
    pages.delete(key);
    return undefined;
  }
  return snapshot;
}

export function writeFavPage(key: string, medias: FavMedia[], hasMore: boolean) {
  pages.delete(key);
  if (pages.size >= MAX_PAGES) pages.delete(pages.keys().next().value as string);
  pages.set(key, { hasMore, medias, savedAt: Date.now() });
}

export function getCachedPlayCount(media: Pick<FavMedia, "id" | "type">) {
  return playCounts.get(favMediaKey(media));
}

export function rememberPlayCount(media: Pick<FavMedia, "id" | "type">, play: number) {
  if (play > 0) playCounts.set(favMediaKey(media), play);
}

// 本机刚改过收藏夹（删除、清理失效），旧快照已知不对，直接丢掉而不是先展示再纠正
export function forgetFavFolder(folderId: string) {
  for (const key of pages.keys()) {
    if (key.startsWith(`${folderId}|`)) pages.delete(key);
  }
}
