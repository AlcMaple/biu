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
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60),
  tombstoneRetentionDays: Number(process.env.TOMBSTONE_RETENTION_DAYS ?? 30),
};
