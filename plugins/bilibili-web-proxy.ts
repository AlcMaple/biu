import type { ProxyConfig, ProxyOptions } from "@rsbuild/core";
import type { ClientRequest, IncomingHttpHeaders } from "node:http";

import { BILIBILI_UPSTREAMS } from "../shared/bilibili-web-proxy";

export const BILIBILI_WEB_PROXY_REQUEST_HEADERS = {
  Origin: "https://www.bilibili.com",
  Referer: "https://www.bilibili.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
} as const;

export function rewriteBilibiliProxyPath(path: string, proxyPrefix: string) {
  if (!path.startsWith(proxyPrefix)) return path;

  const upstreamPath = path.slice(proxyPrefix.length);
  if (!upstreamPath) return "/";
  return upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
}

export function overwriteBilibiliProxyRequestHeaders(proxyRequest: Pick<ClientRequest, "removeHeader" | "setHeader">) {
  for (const [name, value] of Object.entries(BILIBILI_WEB_PROXY_REQUEST_HEADERS)) {
    proxyRequest.setHeader(name, value);
  }

  // Web 版目前没有 B 站登录态，禁止把本站 cookie 意外转发给第三方上游。
  proxyRequest.removeHeader("cookie");
}

export function stripBilibiliSetCookie(headers: IncomingHttpHeaders) {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === "set-cookie") delete headers[name];
  }
}

function createProxyOptions(target: string, proxyPrefix: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    secure: true,
    headers: { ...BILIBILI_WEB_PROXY_REQUEST_HEADERS },
    pathRewrite: path => rewriteBilibiliProxyPath(path, proxyPrefix),
    onProxyReq: proxyRequest => overwriteBilibiliProxyRequestHeaders(proxyRequest),
    onProxyRes: proxyResponse => stripBilibiliSetCookie(proxyResponse.headers),
  };
}

export function createBilibiliWebProxyConfig(): ProxyConfig {
  return Object.fromEntries(
    Object.values(BILIBILI_UPSTREAMS).map(({ origin, proxyPrefix }) => [
      proxyPrefix,
      createProxyOptions(origin, proxyPrefix),
    ]),
  );
}
