import { CapacitorCookies, CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

import { ALIGN_TOKEN_EXCHANGE_URL, matchAlignRoute, normalizeAlignServerUrl } from "@shared/lyrics-align";
import { StoreNameMap } from "@shared/store";

// 原生移动端与 electron/ipc/lyrics-align.ts 对等：WebView 里 axios 有 CORS 且带不上 B 站 cookie，走 Capacitor HTTP

const errorResponse = (status: number, message: string): AlignResponse => ({
  status,
  data: { error: { code: "CLIENT", message } },
});

let cachedToken: string | undefined;

async function readServerUrl() {
  try {
    const { value } = await Preferences.get({ key: `biu:${StoreNameMap.AppSettings}` });
    const settings = value ? (JSON.parse(value) as { appSettings?: Partial<AppSettings> }) : undefined;
    return normalizeAlignServerUrl(settings?.appSettings?.alignServerUrl);
  } catch {
    return normalizeAlignServerUrl(undefined);
  }
}

async function exchangeToken(): Promise<string | AlignResponse> {
  if (cachedToken) return cachedToken;
  const cookies = await CapacitorCookies.getCookies({ url: "https://www.bilibili.com" });
  const sessdata = cookies?.SESSDATA;
  if (!sessdata) return errorResponse(401, "请先登录 B 站，歌词对齐要用登录身份记录每日次数和提交");
  const res = await CapacitorHttp.request({
    url: ALIGN_TOKEN_EXCHANGE_URL,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: { cookie: `SESSDATA=${sessdata}` },
  });
  if (res.status === 401 || res.status === 400) return errorResponse(401, "B 站登录已失效，请重新登录后再试");
  const token = (res.data as { token?: unknown } | undefined)?.token;
  if (res.status !== 200 || typeof token !== "string" || !token) {
    return errorResponse(502, `登录服务暂时不可用（HTTP ${res.status}），请稍后再试`);
  }
  cachedToken = token;
  return token;
}

async function send(base: string, req: AlignRequest, token: string | undefined): Promise<AlignResponse> {
  const res = await CapacitorHttp.request({
    url: `${base}${req.path}`,
    method: req.method,
    headers: {
      ...(req.method === "POST" ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(req.method === "POST" ? { data: req.body ?? {} } : {}),
    connectTimeout: 15_000,
    readTimeout: 15_000,
  });
  if (typeof res.data !== "object" || res.data === null) {
    return errorResponse(res.status, `歌词对齐服务返回了无法识别的内容（HTTP ${res.status}），请检查设置里的服务地址`);
  }
  return { status: res.status, data: res.data };
}

export async function nativeAlignRequest(req: AlignRequest): Promise<AlignResponse> {
  const route = matchAlignRoute(req.method, req.path);
  if (!route) return errorResponse(400, "不支持的歌词对齐请求");
  const base = await readServerUrl();
  try {
    let token: string | undefined;
    if (route.auth) {
      const exchanged = await exchangeToken();
      if (typeof exchanged !== "string") return exchanged;
      token = exchanged;
    }
    const res = await send(base, req, token);
    if (res.status === 401 && route.auth) {
      cachedToken = undefined;
      const retried = await exchangeToken();
      return typeof retried === "string" ? await send(base, req, retried) : retried;
    }
    return res;
  } catch (err) {
    return errorResponse(0, `连不上歌词对齐服务（${base}，${String(err)}），请检查网络或设置里的服务地址`);
  }
}
