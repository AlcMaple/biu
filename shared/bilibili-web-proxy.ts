export const BILIBILI_WEB_PROXY_ROOT = "/__biu_proxy/bilibili";
export const BILIBILI_MEDIA_PROXY_PREFIX = `${BILIBILI_WEB_PROXY_ROOT}/media`;

export const BILIBILI_UPSTREAMS = {
  search: {
    origin: "https://s.search.bilibili.com",
    proxyPrefix: `${BILIBILI_WEB_PROXY_ROOT}/search`,
  },
  www: {
    origin: "https://www.bilibili.com",
    proxyPrefix: `${BILIBILI_WEB_PROXY_ROOT}/www`,
  },
  member: {
    origin: "https://member.bilibili.com",
    proxyPrefix: `${BILIBILI_WEB_PROXY_ROOT}/member`,
  },
  api: {
    origin: "https://api.bilibili.com",
    proxyPrefix: `${BILIBILI_WEB_PROXY_ROOT}/api`,
  },
  passport: {
    origin: "https://passport.bilibili.com",
    proxyPrefix: `${BILIBILI_WEB_PROXY_ROOT}/passport`,
  },
} as const;

export type BilibiliUpstream = keyof typeof BILIBILI_UPSTREAMS;

export function resolveBilibiliBaseURL(upstream: BilibiliUpstream, web: boolean) {
  const endpoint = BILIBILI_UPSTREAMS[upstream];
  return web ? endpoint.proxyPrefix : endpoint.origin;
}

/** 只认根相对地址；浏览器里同源的绝对地址（audio.src）也去掉 origin 后再判断，其他域名一律不认 */
function toMediaProxyPath(value: string) {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin && value.startsWith(`${origin}/`) ? value.slice(origin.length) : value;
}

const MEDIA_PROXY_PATH_PATTERN = /^\/([-_0-9A-Za-z]{32,128})(?:\?e=(\d+))?$/;

export function isBilibiliMediaProxyUrl(value: string | undefined): value is string {
  if (!value) return false;
  const path = toMediaProxyPath(value);
  if (!path.startsWith(`${BILIBILI_MEDIA_PROXY_PREFIX}/`)) return false;
  return MEDIA_PROXY_PATH_PATTERN.test(path.slice(BILIBILI_MEDIA_PROXY_PREFIX.length));
}

/** 同源媒体地址的到期时间（Unix 秒）；旧格式不带到期提示时返回 undefined */
export function getBilibiliMediaProxyExpiry(value: string | undefined): number | undefined {
  if (!isBilibiliMediaProxyUrl(value)) return undefined;
  const match = toMediaProxyPath(value).slice(BILIBILI_MEDIA_PROXY_PREFIX.length).match(MEDIA_PROXY_PATH_PATTERN);
  return match?.[2] ? Number(match[2]) : undefined;
}
