// 匿名 Web 也会收到 WBI 密钥，但 user store 只保存已登录用户；不单独缓存就会让
// 搜索、视频详情和播放地址解析反复等待 /nav。密钥不是账号凭据，只留在当前页面内存。

export interface WbiImageLike {
  img_url?: string;
  sub_url?: string;
}

export interface WbiKeys {
  img_key: string;
  sub_key: string;
}

// WBI 密钥通常不会频繁变化；10 分钟（毫秒）可减少 /nav 请求，也限制旧密钥的使用时间。
export const WBI_KEY_CACHE_TTL_MS = 10 * 60 * 1000;

interface CachedWbiKeys {
  keys: WbiKeys;
  expiresAt: number;
}

let cachedWbiKeys: CachedWbiKeys | undefined;

function keyFromUrl(value: string | undefined): string {
  if (!value) return "";

  try {
    const pathname = new URL(value.startsWith("//") ? `https:${value}` : value).pathname;
    const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
    const dot = filename.lastIndexOf(".");
    return dot > 0 ? filename.slice(0, dot) : "";
  } catch {
    return "";
  }
}

export function extractWbiKeys(image: WbiImageLike | null | undefined): WbiKeys | undefined {
  const img_key = keyFromUrl(image?.img_url);
  const sub_key = keyFromUrl(image?.sub_url);
  if (!img_key || !sub_key) return undefined;
  return { img_key, sub_key };
}

export function cacheWbiKeys(image: WbiImageLike | null | undefined, now = Date.now()): WbiKeys | undefined {
  const keys = extractWbiKeys(image);
  if (!keys) return undefined;

  cachedWbiKeys = { keys, expiresAt: now + WBI_KEY_CACHE_TTL_MS };
  return keys;
}

export function getCachedWbiKeys(now = Date.now()): WbiKeys | undefined {
  if (!cachedWbiKeys || cachedWbiKeys.expiresAt <= now) return undefined;
  return cachedWbiKeys.keys;
}

// /nav 暂时失败时允许 WBI 请求借用旧密钥；下一次成功响应会刷新缓存。
export function getStaleWbiKeys(): WbiKeys | undefined {
  return cachedWbiKeys?.keys;
}

export function clearWbiKeyCache() {
  cachedWbiKeys = undefined;
}
