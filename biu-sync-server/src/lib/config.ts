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

export const config = {
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
