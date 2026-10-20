import { ipcMain, session } from "electron";
import got from "got";

import { ALIGN_TOKEN_EXCHANGE_URL, matchAlignRoute, normalizeAlignServerUrl } from "@shared/lyrics-align";

import { appSettingsStore } from "../store";
import { channel } from "./channel";

class AlignTransportError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const errorResponse = (status: number, message: string): AlignResponse => ({
  status,
  data: { error: { code: "CLIENT", message } },
});

// token 只在主进程里换、只在主进程里用，渲染层拿不到
let cachedToken: string | undefined;

async function exchangeToken(): Promise<string> {
  // 本地 mock 开发：biu-align-server 的 `pnpm token` 签出的测试 token，正式密钥换不出能在本机服务验签的 token
  if (process.env.BIU_ALIGN_TOKEN) return process.env.BIU_ALIGN_TOKEN;
  if (cachedToken) return cachedToken;
  const [sessdata] = await session.defaultSession.cookies.get({ name: "SESSDATA", domain: ".bilibili.com" });
  if (!sessdata?.value) throw new AlignTransportError(401, "请先登录 B 站，上传歌词、报错和逐字对齐都要用登录身份");
  const res = await got.post(ALIGN_TOKEN_EXCHANGE_URL, {
    json: { cookie: `SESSDATA=${sessdata.value}` },
    timeout: { request: 10_000 },
    retry: { limit: 0 },
    throwHttpErrors: false,
  });
  if (res.statusCode === 401 || res.statusCode === 400) {
    throw new AlignTransportError(401, "B 站登录已失效，请重新登录后再试");
  }
  if (res.statusCode !== 200) {
    throw new AlignTransportError(502, `登录服务暂时不可用（HTTP ${res.statusCode}），请稍后再试`);
  }
  const token = (JSON.parse(res.body) as { token?: unknown }).token;
  if (typeof token !== "string" || !token) throw new AlignTransportError(502, "登录服务返回的数据不对，请稍后再试");
  cachedToken = token;
  return token;
}

async function send(base: string, req: AlignRequest, token: string | undefined): Promise<AlignResponse> {
  const res = await got(`${base}${req.path}`, {
    method: req.method,
    ...(req.method === "POST" ? { json: req.body ?? {} } : {}),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    timeout: { request: 15_000 },
    // 5xx / 限流不重试：惩罚窗口里加戳只会延长限制（AGENTS.md「网络请求」）
    retry: { limit: 0 },
    throwHttpErrors: false,
  });
  let data: unknown;
  try {
    data = JSON.parse(res.body);
  } catch {
    return errorResponse(
      res.statusCode,
      `歌词对齐服务返回了无法识别的内容（HTTP ${res.statusCode}），请检查设置里的服务地址`,
    );
  }
  return { status: res.statusCode, data };
}

export async function alignRequest(req: AlignRequest): Promise<AlignResponse> {
  const route = matchAlignRoute(req.method, req.path);
  if (!route) return errorResponse(400, "不支持的歌词对齐请求");
  const base = normalizeAlignServerUrl(appSettingsStore.get("appSettings").alignServerUrl);
  try {
    const res = await send(base, req, route.auth ? await exchangeToken() : undefined);
    // token 过期 / 服务端换了密钥：重新换一次再发，仍 401 就交给用户（不循环）
    if (res.status === 401 && route.auth && cachedToken) {
      cachedToken = undefined;
      return await send(base, req, await exchangeToken());
    }
    return res;
  } catch (err) {
    if (err instanceof AlignTransportError) return errorResponse(err.status, err.message);
    const code = (err as { code?: string }).code ?? "";
    return errorResponse(0, `连不上歌词对齐服务（${base}${code ? `，${code}` : ""}），请检查网络或设置里的服务地址`);
  }
}

export function registerLyricsAlignHandlers() {
  ipcMain.handle(channel.lyrics.alignRequest, (_, req: AlignRequest) => alignRequest(req));
}
