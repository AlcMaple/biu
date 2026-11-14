// 本地「假 B 站」：沙盒里 BFF 和同步服务的所有外部请求都被改投到这里（见 web-server/sandbox-upstream.ts），
// 路径形如 /__host/<真实域名>/<真实路径>。按真实接口形状回数据，B 站之外的页面和状态机都是真代码。
// 设计见 docs/ideas/008-本地沙盒测试.md；由 scripts/sandbox.mjs 用 tsx 启动。
import { randomBytes } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import {
  SANDBOX_AUDIO_SECONDS,
  SANDBOX_IDENTITIES,
  type SandboxFault,
  type SandboxIdentityId,
  type SandboxUpstreamState,
} from "../../shared/sandbox";
import { DEMO_FAV_MEDIA, DEMO_USER, DEMO_VIDEOS, offlineDemoResponse } from "../../src/common/offline-demo-fixtures";
import { sendSandboxAudio } from "./audio";
import { sandboxNeteaseLyrics, sandboxNeteaseSearch } from "./lyrics";

const HOST_PREFIX = "/__host/";
const CONTROL_PREFIX = "/__sandbox/";

// ---------- 账号 ----------
// mid 是假的（900xxx），和真实 B 站无关；管理员 mid 要和 scripts/sandbox.mjs 的 ADMIN_MIDS 一致
interface Account {
  id: SandboxIdentityId;
  label: string;
  mid: number;
  vip: boolean;
}
const ACCOUNTS: Account[] = SANDBOX_IDENTITIES.filter(i => i.mid).map(i => ({
  id: i.id,
  label: i.label,
  mid: Number(i.mid),
  // B 用来看非会员（无法选高音质等）的分支
  vip: i.id !== "userB",
}));

// SESSDATA 编进 mid，假服务重启后 BFF 里落盘的会话仍然认得；退出登录的 token 进黑名单
const revoked = new Set<string>();
const sessdataFor = (mid: number) => `sandbox_${mid}_${randomBytes(8).toString("hex")}`;
function accountFromCookie(cookie: string | undefined): Account | undefined {
  const value = cookie
    ?.split(";")
    .map(part => part.trim())
    .find(part => part.startsWith("SESSDATA="))
    ?.slice("SESSDATA=".length);
  if (!value || revoked.has(value)) return undefined;
  const mid = Number(value.match(/^sandbox_(\d+)_/)?.[1]);
  return ACCOUNTS.find(a => a.mid === mid);
}

function userOf(account: Account) {
  return {
    ...DEMO_USER,
    mid: account.mid,
    uname: `沙盒${account.label}`,
    vipStatus: account.vip ? 1 : 0,
    vipType: account.vip ? 2 : 0,
    vip_label: { ...DEMO_USER.vip_label, text: account.vip ? "年度大会员" : "" },
    wallet: { ...DEMO_USER.wallet, mid: account.mid },
  };
}

// ---------- 收藏夹（按账号分开，存在内存里；重启假服务恢复初始状态） ----------
interface Folder {
  id: number;
  title: string;
  aids: number[];
}
const allAids = DEMO_VIDEOS.map(v => v.aid);
const folders = new Map<number, Folder[]>([
  [
    900001,
    [
      { id: 101, title: "默认收藏夹", aids: allAids },
      { id: 102, title: "A 的通勤歌单", aids: allAids.slice(0, 5) },
    ],
  ],
  [900002, [{ id: 501, title: "默认收藏夹", aids: allAids.slice(8) }]],
  [900009, [{ id: 901, title: "默认收藏夹", aids: allAids.slice(0, 6) }]],
]);
const folderOf = (id: number) => [...folders.values()].flat().find(f => f.id === id);
const ownerOf = (id: number) => [...folders.entries()].find(([, list]) => list.some(f => f.id === id))?.[0];

// ---------- 故障开关 ----------
// match 是对「域名+路径」的子串匹配；kind 对应真实里出现过的几种失败（见 AGENTS.md 网络请求一节）
const state: SandboxUpstreamState = {
  faults: [] as SandboxFault[],
  // playurl 主地址给 PCDN（mcdn），模拟「能拿到流但播不动」
  pcdn: false,
  // fav/resource/list 的 cnt_info.play 全给 0，模拟收藏夹接口播放量为 0 的事故
  zeroPlay: false,
};
// 二维码：auth_code → 被哪个账号确认
const qrcodes = new Map<string, { account?: Account; expiresAt: number }>();

// ---------- 工具 ----------
const base = (data: unknown) => ({ code: 0, message: "0", ttl: 1, data });
function sendJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(body);
}
async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
function formOrJson(raw: string, contentType: string | undefined): Record<string, string> {
  if (!raw) return {};
  if (contentType?.includes("json")) return JSON.parse(raw) as Record<string, string>;
  return Object.fromEntries(new URLSearchParams(raw));
}

// ---------- B 站接口 ----------
const mediaOf = (aid: number) => {
  const media = DEMO_FAV_MEDIA.find(m => m.id === aid)!;
  return state.zeroPlay ? { ...media, cnt_info: { ...media.cnt_info, play: 0 } } : media;
};
function folderInfo(folder: Folder, mid: number) {
  const user = userOf(ACCOUNTS.find(a => a.mid === mid)!);
  return {
    id: folder.id,
    fid: folder.id,
    mid,
    attr: folder.id % 100 === 1 ? 0 : 22,
    title: folder.title,
    cover: DEMO_VIDEOS.find(v => v.aid === folder.aids[0])?.pic ?? "",
    upper: {
      mid,
      name: user.uname,
      face: user.face,
      followed: false,
      vip_type: user.vipType,
      vip_statue: user.vipStatus,
    },
    cover_type: 2,
    cnt_info: { collect: 0, play: 0, thumb_up: 0, share: 0 },
    type: 11,
    intro: "",
    ctime: 0,
    mtime: 0,
    state: 0,
    fav_state: 0,
    like_state: 0,
    media_count: folder.aids.length,
  };
}

// 播放地址用真实形状的 UPOS 域名：BFF 的媒体放行名单、token 改写都照真实流程走，出站时才改投回本机
const uposUrl = (song: number) =>
  `https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/sandbox/${song}.m4s?deadline=${Math.floor(Date.now() / 1000) + 86_400}&os=cos`;
const pcdnUrl = (song: number) =>
  `https://xy1x2x3x4xy.mcdn.bilivideo.cn:4483/upgcxcode/sandbox/${song}.m4s?deadline=${Math.floor(Date.now() / 1000) + 86_400}`;

function videoOf(params: URLSearchParams) {
  const bvid = params.get("bvid");
  const aid = Number(params.get("aid") ?? params.get("avid"));
  return DEMO_VIDEOS.find(v => v.bvid === bvid || v.aid === aid) ?? DEMO_VIDEOS[0];
}

async function handleApi(path: string, params: URLSearchParams, request: IncomingMessage, response: ServerResponse) {
  const account = accountFromCookie(request.headers.cookie);
  const method = request.method ?? "GET";
  const body = method === "POST" ? formOrJson(await readBody(request), request.headers["content-type"]) : {};

  if (path === "/x/web-interface/nav") {
    if (!account)
      return sendJson(response, 200, {
        code: -101,
        message: "账号未登录",
        ttl: 1,
        data: { isLogin: false, wbi_img: DEMO_USER.wbi_img },
      });
    return sendJson(response, 200, base(userOf(account)));
  }

  if (path.startsWith("/x/v3/fav/")) {
    const needLogin = path.includes("/resource/deal") || path.includes("/folder/created/list-all");
    if (needLogin && !account) return sendJson(response, 200, { code: -101, message: "账号未登录", ttl: 1 });

    if (path.includes("folder/created/list")) {
      const upMid = Number(params.get("up_mid")) || account?.mid || 0;
      const list = (folders.get(upMid) ?? []).map(f => folderInfo(f, upMid));
      const rid = Number(params.get("rid"));
      const withState = rid ? list.map(f => ({ ...f, fav_state: folderOf(f.id)!.aids.includes(rid) ? 1 : 0 })) : list;
      return sendJson(response, 200, base({ count: list.length, list: withState, has_more: false }));
    }
    if (path.includes("folder/collected/list")) return sendJson(response, 200, base({ count: 0, list: [] }));
    if (path.includes("folder/info")) {
      const folder = folderOf(Number(params.get("media_id")));
      if (!folder) return sendJson(response, 200, { code: -404, message: "啥都木有", ttl: 1 });
      return sendJson(response, 200, base(folderInfo(folder, ownerOf(folder.id)!)));
    }
    if (path.includes("resource/list")) {
      const folder = folderOf(Number(params.get("media_id")));
      if (!folder) return sendJson(response, 200, { code: -404, message: "啥都木有", ttl: 1 });
      const ps = Number(params.get("ps")) || 20;
      const pn = Number(params.get("pn")) || 1;
      const page = folder.aids.slice((pn - 1) * ps, pn * ps);
      return sendJson(
        response,
        200,
        base({
          info: folderInfo(folder, ownerOf(folder.id)!),
          medias: page.map(mediaOf),
          has_more: pn * ps < folder.aids.length,
          ttl: Math.floor(Date.now() / 1000),
        }),
      );
    }
    if (path.includes("resource/ids")) {
      const folder = folderOf(Number(params.get("media_id")));
      const ids = (folder?.aids ?? []).map(mediaOf).map(m => ({ id: m.id, type: 2, bv_id: m.bvid, bvid: m.bvid }));
      return sendJson(response, 200, base(ids));
    }
    if (path.includes("resource/deal")) {
      const rid = Number(body.rid);
      const own = folders.get(account!.mid) ?? [];
      const split = (value?: string) => (value ? value.split(",").map(Number) : []);
      for (const id of split(body.add_media_ids)) {
        const folder = own.find(f => f.id === id);
        if (folder && !folder.aids.includes(rid)) folder.aids.unshift(rid);
      }
      for (const id of split(body.del_media_ids)) {
        const folder = own.find(f => f.id === id);
        if (folder) folder.aids = folder.aids.filter(aid => aid !== rid);
      }
      return sendJson(response, 200, base({ prompt: false }));
    }
  }

  if (path.includes("player/pagelist") || path.includes("web-interface/view")) {
    const item = videoOf(params);
    const pages = [
      { cid: item.aid + 10, page: 1, part: "正片", duration: SANDBOX_AUDIO_SECONDS, first_frame: item.pic },
    ];
    if (path.includes("player/pagelist")) return sendJson(response, 200, base(pages));
    return sendJson(
      response,
      200,
      base({
        aid: item.aid,
        bvid: item.bvid,
        title: item.title,
        pic: item.pic,
        duration: SANDBOX_AUDIO_SECONDS,
        owner: { mid: item.mid, name: item.author, face: item.pic },
        stat: { view: item.play },
        pages,
      }),
    );
  }

  if (path.includes("player/wbi/playurl") || path === "/x/player/playurl") {
    const item = videoOf(params);
    const upos = uposUrl(item.aid);
    const primary = state.pcdn ? pcdnUrl(item.aid) : upos;
    const backup = state.pcdn ? [upos] : [];
    return sendJson(
      response,
      200,
      base({
        quality: 64,
        format: "mp4",
        timelength: SANDBOX_AUDIO_SECONDS * 1000,
        dash: {
          duration: SANDBOX_AUDIO_SECONDS,
          video: [],
          audio: [
            {
              id: 30280,
              baseUrl: primary,
              base_url: primary,
              backupUrl: backup,
              backup_url: backup,
              bandwidth: 352_800,
              mimeType: "audio/wav",
              mime_type: "audio/wav",
              codecs: "pcm_s16le",
            },
          ],
        },
      }),
    );
  }

  // 其余只读接口沿用离线 Demo 的同一份假数据
  return sendJson(
    response,
    200,
    offlineDemoResponse({ url: path, method, params: Object.fromEntries(params), data: body }),
  );
}

async function handlePassport(path: string, request: IncomingMessage, response: ServerResponse) {
  const body = formOrJson(await readBody(request), request.headers["content-type"]);

  if (path === "/x/passport-tv-login/qrcode/auth_code") {
    const authCode = randomBytes(16).toString("hex");
    qrcodes.set(authCode, { expiresAt: Date.now() + 180_000 });
    return sendJson(
      response,
      200,
      base({
        url: `http://${request.headers.host}${CONTROL_PREFIX}confirm?auth_code=${authCode}`,
        auth_code: authCode,
      }),
    );
  }
  if (path === "/x/passport-tv-login/qrcode/poll") {
    const entry = qrcodes.get(body.auth_code ?? "");
    if (!entry || entry.expiresAt < Date.now())
      return sendJson(response, 200, { code: 86038, message: "二维码已失效" });
    if (!entry.account) return sendJson(response, 200, { code: 86039, message: "二维码尚未确认" });
    qrcodes.delete(body.auth_code!);
    const { mid } = entry.account;
    const expires = Math.floor(Date.now() / 1000) + 180 * 86_400;
    return sendJson(
      response,
      200,
      base({
        mid,
        refresh_token: randomBytes(16).toString("hex"),
        cookie_info: {
          cookies: [
            { name: "SESSDATA", value: sessdataFor(mid), expires },
            { name: "bili_jct", value: randomBytes(16).toString("hex"), expires },
            { name: "DedeUserID", value: String(mid), expires },
          ],
        },
      }),
    );
  }
  if (path === "/x/passport-login/web/cookie/info") return sendJson(response, 200, base({ refresh: false }));
  if (path === "/login/exit/v2") {
    const sessdata = request.headers.cookie?.match(/SESSDATA=([^;]+)/)?.[1];
    if (sessdata) revoked.add(sessdata);
    return sendJson(response, 200, base({ redirectUrl: "https://www.bilibili.com" }));
  }
  // 短信登录要过极验验证码（第三方组件，前端直接加载它的脚本），本机造不出来：明确报错而不是空转
  if (path.startsWith("/x/passport-login/")) {
    return sendJson(response, 200, { code: -400, message: "沙盒不支持短信登录，请用扫码登录或沙盒菜单切换身份" });
  }
  return sendJson(response, 404, { code: -404, message: `假 B 站没有实现 ${path}` });
}

// ---------- 控制面（只在本机，给沙盒菜单和扫码确认页用） ----------
const confirmPage = (authCode: string) => `<!doctype html><meta charset="utf-8"><title>沙盒扫码确认</title>
<style>body{font:15px -apple-system,'PingFang SC',sans-serif;background:#17181a;color:#eee;display:grid;place-items:center;height:100vh;margin:0}
button{display:block;width:220px;margin:10px 0;padding:10px;border:0;border-radius:8px;background:#fb7299;color:#fff;font-size:15px;cursor:pointer}</style>
<div><p>用哪个沙盒账号确认这次登录？</p>
${ACCOUNTS.map(a => `<form method="post"><input type="hidden" name="auth_code" value="${authCode}"><input type="hidden" name="account" value="${a.id}"><button>${a.label}</button></form>`).join("")}
</div>`;

async function handleControl(
  path: string,
  params: URLSearchParams,
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (path === "confirm") {
    const authCode = params.get("auth_code") ?? "";
    if (request.method === "POST") {
      const body = formOrJson(await readBody(request), request.headers["content-type"]);
      const ok = approve(body.auth_code ?? authCode, body.account as SandboxIdentityId);
      response.writeHead(ok ? 200 : 410, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><meta charset="utf-8"><p style="font:15px sans-serif">${ok ? "已确认，回到 Biu 页面即可" : "二维码已失效"}</p>`,
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(confirmPage(authCode.replace(/[^0-9a-f]/g, "")));
    return;
  }
  if (path === "approve" && request.method === "POST") {
    const body = formOrJson(await readBody(request), "application/json");
    const ok = approve(body.authCode, body.account as SandboxIdentityId);
    return sendJson(response, ok ? 200 : 410, ok ? { ok } : { ok, message: "二维码已失效" });
  }
  if (path === "state") {
    if (request.method === "POST") {
      const next = JSON.parse((await readBody(request)) || "{}") as Partial<SandboxUpstreamState>;
      if (Array.isArray(next.faults)) state.faults = next.faults.filter(f => f.match && f.kind);
      if (typeof next.pcdn === "boolean") state.pcdn = next.pcdn;
      if (typeof next.zeroPlay === "boolean") state.zeroPlay = next.zeroPlay;
    }
    return sendJson(response, 200, state);
  }
  return sendJson(response, 404, { message: "unknown sandbox control" });
}

function approve(authCode: string | undefined, accountId: SandboxIdentityId) {
  const entry = authCode ? qrcodes.get(authCode) : undefined;
  const account = ACCOUNTS.find(a => a.id === accountId);
  if (!entry || !account || entry.expiresAt < Date.now()) return false;
  entry.account = account;
  return true;
}

// ---------- 入口 ----------
async function applyFault(target: string, response: ServerResponse) {
  const fault = state.faults.find(f => target.includes(f.match));
  if (!fault) return false;
  switch (fault.kind) {
    case "412":
      // B 站风控拦截是 HTTP 412 + HTML 页面
      response.writeHead(412, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        "<html><body>The request was rejected because of the bilibili security control policy.</body></html>",
      );
      return true;
    case "429":
      sendJson(response, 429, { code: -509, message: "请求过于频繁，请稍后再试" }, { "Retry-After": "30" });
      return true;
    case "500":
      sendJson(response, 500, { code: -500, message: "服务器错误" });
      return true;
    case "timeout":
      // 不回任何东西，等 BFF 自己超时（30 s）
      return true;
    case "reset":
      response.socket?.destroy();
      return true;
  }
}

export const createSandboxBilibiliServer = () =>
  http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://sandbox.local");
      if (url.pathname.startsWith(CONTROL_PREFIX)) {
        return handleControl(url.pathname.slice(CONTROL_PREFIX.length), url.searchParams, request, response);
      }
      if (!url.pathname.startsWith(HOST_PREFIX)) return sendJson(response, 404, { message: "not a sandbox upstream" });
      const rest = url.pathname.slice(HOST_PREFIX.length);
      const slash = rest.indexOf("/");
      const host = slash < 0 ? rest : rest.slice(0, slash);
      const path = slash < 0 ? "/" : rest.slice(slash);
      if (await applyFault(`${host}${path}`, response)) return;

      if (host === "api.bilibili.com" || host === "www.bilibili.com" || host === "s.search.bilibili.com") {
        return handleApi(path, url.searchParams, request, response);
      }
      if (host === "passport.bilibili.com") return handlePassport(path, request, response);
      if (/^upos-[a-z0-9-]+\.bilivideo\.com$/.test(host)) {
        const song = Number(path.match(/\/(\d+)\.m4s$/)?.[1]) || 0;
        return sendSandboxAudio(song, request.headers.range, response);
      }
      // PCDN 节点：连上了但一直不出数据，和真实「卡死」一样
      if (host.endsWith(".mcdn.bilivideo.cn")) return;
      if (host === "interface.music.163.com") {
        if (path === "/api/search/get")
          return sendJson(response, 200, sandboxNeteaseSearch(url.searchParams.get("s") ?? ""));
        if (path === "/api/song/lyric")
          return sendJson(response, 200, sandboxNeteaseLyrics(Number(url.searchParams.get("id"))));
        return sendJson(response, 200, { code: 200, result: {} });
      }
      if (host === "lrclib.net") return sendJson(response, 200, []);
      sendJson(response, 404, { code: -404, message: `假 B 站没有实现 ${host}${path}` });
    })().catch(error => {
      console.error("[sandbox-bilibili]", error);
      if (!response.headersSent) sendJson(response, 500, { code: -500, message: String(error) });
    });
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3010);
  createSandboxBilibiliServer().listen(port, "127.0.0.1", () => {
    console.log(`[sandbox-bilibili] 假 B 站 http://127.0.0.1:${port}`);
  });
}
