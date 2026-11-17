import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[fatal] ${name} missing. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

// 本地沙盒（主仓库 `pnpm sandbox`）把校验 Cookie 用的 nav 请求改投到本机假 B 站；只认回环 http，生产环境设了直接退出
function sandboxBilibiliOrigin(): string | undefined {
  const value = process.env.BIU_SANDBOX_UPSTREAM_ORIGIN?.trim();
  if (!value) return undefined;
  const url = new URL(value);
  if (
    process.env.NODE_ENV === "production" ||
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname)
  ) {
    console.error("[fatal] BIU_SANDBOX_UPSTREAM_ORIGIN 只能在本机沙盒里指向回环 http 地址");
    process.exit(1);
  }
  return url.origin;
}

const sandboxOrigin = sandboxBilibiliOrigin();

export const config = {
  bilibiliNavUrl: sandboxOrigin
    ? `${sandboxOrigin}/__host/api.bilibili.com/x/web-interface/nav`
    : "https://api.bilibili.com/x/web-interface/nav",
  port: Number(process.env.PORT ?? 3002),
  jwtSecret: required("JWT_SECRET"),
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 7200),
  dataDir: process.env.DATA_DIR ?? "/data/biu-sync",
  corsOrigin: process.env.CORS_ORIGIN?.trim() || undefined,
  // 这是单用户自用服务，一次用户操作会产生若干请求，两台设备共用同一个 mid 的额度。
  // 60/min 实测会被正常使用打满（真实事故：两分钟内 58 个请求被 429，同步整个停摆）。
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 600),
  tombstoneRetentionDays: Number(process.env.TOMBSTONE_RETENTION_DAYS ?? 30),
};
