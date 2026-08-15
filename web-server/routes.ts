import {
  BILIBILI_MEDIA_PROXY_PREFIX,
  BILIBILI_UPSTREAMS,
  type BilibiliUpstream,
} from "../shared/bilibili-web-proxy.js";

const MAX_MEDIA_URL_LENGTH = 8192;
const MEDIA_PATH_PREFIXES = ["/upgcxcode/", "/v1/resource/", "/bfs/music/", "/audio/"] as const;

const normalizeHostname = (hostname: string) => hostname.toLowerCase().replace(/\.$/, "");

const isAllowedMediaHostAndPort = (url: URL) => {
  const hostname = normalizeHostname(url.hostname);

  if (/^upos-[a-z0-9-]+\.bilivideo\.com$/.test(hostname)) {
    return url.port === "" || url.port === "443";
  }

  if (/^upos-[a-z0-9-]+\.akamaized\.net$/.test(hostname)) return url.port === "" || url.port === "443";

  return false;
};

export function normalizeBilibiliMediaSource(source: string): string | undefined {
  const trimmed = source.trim();
  if (!trimmed || trimmed.length > MAX_MEDIA_URL_LENGTH) return undefined;

  const withProtocol = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  try {
    const url = new URL(withProtocol);
    if (url.protocol === "http:") url.protocol = "https:";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isAllowedBilibiliMediaUrl(source: string | URL): boolean {
  let url: URL;
  try {
    url = source instanceof URL ? source : new URL(source);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || !isAllowedMediaHostAndPort(url)) {
    return false;
  }

  return MEDIA_PATH_PREFIXES.some(prefix => url.pathname.startsWith(prefix));
}

export function matchBilibiliApiProxyRequest(requestUrl: string) {
  const url = new URL(requestUrl, "http://biu.local");

  for (const [upstream, endpoint] of Object.entries(BILIBILI_UPSTREAMS)) {
    if (url.pathname !== endpoint.proxyPrefix && !url.pathname.startsWith(`${endpoint.proxyPrefix}/`)) continue;

    const upstreamUrl = new URL(endpoint.origin);
    upstreamUrl.pathname = url.pathname.slice(endpoint.proxyPrefix.length) || "/";
    upstreamUrl.search = url.search;

    return {
      upstream: upstream as BilibiliUpstream,
      target: upstreamUrl,
    };
  }

  return undefined;
}

export function matchBilibiliMediaProxyToken(requestUrl: string): string | undefined {
  const url = new URL(requestUrl, "http://biu.local");
  if (url.search !== "" || !url.pathname.startsWith(`${BILIBILI_MEDIA_PROXY_PREFIX}/`)) return undefined;

  const token = url.pathname.slice(BILIBILI_MEDIA_PROXY_PREFIX.length + 1);
  return /^[-_0-9A-Za-z]{32,128}$/.test(token) ? token : undefined;
}
