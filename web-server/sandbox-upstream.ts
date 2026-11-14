// 本地沙盒（`pnpm sandbox`）把 BFF 的所有外部上游请求改投到本机「假 B 站」（scripts/sandbox-bilibili）。
// 只在出站这一层改地址：放行名单、Cookie 域校验、媒体 token、错误文案都照常按真实域名走，沙盒测到的就是线上那套逻辑。
// 环境变量只由 scripts/sandbox.mjs 设置；生产环境设了就直接拒绝启动，不会悄悄把流量导到别处。

export const SANDBOX_UPSTREAM_ENV = "BIU_SANDBOX_UPSTREAM_ORIGIN";
export const SANDBOX_HOST_PREFIX = "/__host/";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function readSandboxUpstreamOrigin(environment: NodeJS.ProcessEnv = process.env): URL | undefined {
  const value = environment[SANDBOX_UPSTREAM_ENV]?.trim();
  if (!value) return undefined;
  if (environment.NODE_ENV === "production") {
    throw new Error(`${SANDBOX_UPSTREAM_ENV} 只给本机沙盒用，生产环境不能设置`);
  }
  const url = new URL(value);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.pathname !== "/" || url.search) {
    throw new Error(`${SANDBOX_UPSTREAM_ENV} 必须是本机回环地址的 http origin（例如 http://127.0.0.1:3010）`);
  }
  return url;
}

// 进程内的自家服务（同步、对齐）本来就在回环地址上，不改投
export function mapToSandboxUpstream(target: URL, origin: URL | undefined = readSandboxUpstreamOrigin()): URL {
  if (!origin || LOOPBACK_HOSTS.has(target.hostname)) return target;
  return new URL(`${SANDBOX_HOST_PREFIX}${target.hostname}${target.pathname}${target.search}`, origin);
}

export const sandboxAwareFetch: typeof fetch = (input, init) => {
  const origin = readSandboxUpstreamOrigin();
  if (!origin) return fetch(input, init);
  const raw = input instanceof Request ? input.url : input;
  return fetch(mapToSandboxUpstream(new URL(raw), origin), init);
};
