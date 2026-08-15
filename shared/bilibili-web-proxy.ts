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

export function isBilibiliMediaProxyUrl(value: string | undefined): value is string {
  if (!value?.startsWith(`${BILIBILI_MEDIA_PROXY_PREFIX}/`)) return false;

  const token = value.slice(BILIBILI_MEDIA_PROXY_PREFIX.length + 1);
  return /^[-_0-9A-Za-z]{32,128}$/.test(token);
}
