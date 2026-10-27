// 歌词时间轴对齐服务（biu-align-server）的客户端约定，Electron 主进程、渲染层和 Web BFF 共用

// 公网反代把 /align/* 转到服务的 /api/*；本地 mock 开发填 http://127.0.0.1:3003/api
export const DEFAULT_ALIGN_SERVER_URL = "https://biu.alcmaple.cn/align";

// 对齐服务和同步服务共用 JWT_SECRET，token 从同步服务用 B 站 cookie 换（与 src/service/sync 同一个入口）
export const ALIGN_TOKEN_EXCHANGE_URL = "https://biu.alcmaple.cn/api/auth/exchange";

export const WEB_ALIGN_PROXY_ROOT = "/__biu_align";

// 每 3 s 一次；服务端限流按 mid 每分钟 300 次，留足余量。只查正在播的那首，切歌即停，所以同一时刻最多一路轮询
export const ALIGN_POLL_INTERVAL_MS = 3000;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STATUS = "pending|approved|rejected|withdrawn|superseded";
const REPORT_STATUS = "pending|resolved|dismissed";

// 只放行这几条：传输层都在持有用户凭证的一侧（主进程 / 原生 / BFF），白名单之外的路径一律不发，
// 免得渲染层能借它把 token 带去任意接口
const ROUTES: { method: "GET" | "POST"; pattern: RegExp; auth: boolean }[] = [
  { method: "GET", pattern: /^\/me$/, auth: true },
  { method: "POST", pattern: /^\/align\/jobs$/, auth: true },
  { method: "GET", pattern: new RegExp(`^/align/jobs/${UUID}$`), auth: true },
  { method: "GET", pattern: /^\/lyrics\/BV[0-9A-Za-z]{10}\/\d{1,15}$/, auth: false },
  { method: "GET", pattern: /^\/lyrics\/BV[0-9A-Za-z]{10}\/\d{1,15}\/recognized$/, auth: false },
  { method: "POST", pattern: /^\/lyrics\/recognized$/, auth: true },
  { method: "POST", pattern: /^\/lyrics\/screen-jobs$/, auth: true },
  { method: "GET", pattern: new RegExp(`^/lyrics/screen-jobs/${UUID}$`), auth: true },
  { method: "POST", pattern: /^\/lyrics\/submissions$/, auth: true },
  { method: "GET", pattern: /^\/lyrics\/submissions\/mine$/, auth: true },
  { method: "GET", pattern: new RegExp(`^/admin/submissions\\?status=(${STATUS})$`), auth: true },
  { method: "GET", pattern: new RegExp(`^/admin/submissions/${UUID}$`), auth: true },
  { method: "POST", pattern: new RegExp(`^/admin/submissions/${UUID}/(approve|reject)$`), auth: true },
  { method: "POST", pattern: /^\/lyrics\/reports$/, auth: true },
  { method: "GET", pattern: /^\/lyrics\/reports\/mine$/, auth: true },
  { method: "GET", pattern: new RegExp(`^/admin/reports\\?status=(${REPORT_STATUS})$`), auth: true },
  { method: "GET", pattern: new RegExp(`^/admin/reports/${UUID}$`), auth: true },
  { method: "POST", pattern: new RegExp(`^/admin/reports/${UUID}/(resolve|dismiss)$`), auth: true },
  { method: "POST", pattern: /^\/admin\/published$/, auth: true },
  { method: "POST", pattern: /^\/admin\/realign$/, auth: true },
  { method: "GET", pattern: /^\/admin\/drafts\/BV[0-9A-Za-z]{10}\/\d{1,15}$/, auth: true },
  { method: "POST", pattern: /^\/admin\/drafts\/discard$/, auth: true },
];

export function matchAlignRoute(method: string, path: string): { auth: boolean } | undefined {
  const route = ROUTES.find(r => r.method === method && r.pattern.test(path));
  return route ? { auth: route.auth } : undefined;
}

export function normalizeAlignServerUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_ALIGN_SERVER_URL;
  try {
    const url = new URL(trimmed);
    // token 会随请求发出，明文 HTTP 只允许本机（mock 开发）
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? trimmed : DEFAULT_ALIGN_SERVER_URL;
  } catch {
    return DEFAULT_ALIGN_SERVER_URL;
  }
}
