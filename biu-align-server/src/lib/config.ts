import dotenv from "dotenv";
import os from "node:os";
import path from "node:path";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[fatal] ${name} missing. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

const num = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

export const config = {
  port: num("PORT", 3003),
  // 与 biu-sync-server 共用同一个密钥：客户端已经在那边用 B 站 cookie 换过 token，这里只验签，不再接一套登录
  jwtSecret: required("JWT_SECRET"),
  dataDir: process.env.DATA_DIR ?? "/data/biu-align",
  workDir: process.env.WORK_DIR ?? path.join(os.tmpdir(), "biu-align"),
  pythonBin: process.env.PYTHON_BIN ?? "python3",
  corsOrigin: process.env.CORS_ORIGIN?.trim() || undefined,
  // 审核员的 B 站 UID，逗号分隔。只放部署机的 .env，不写进仓库
  adminMids: new Set(
    (process.env.ADMIN_MIDS ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
  ),
  // 每首约 2 min CPU（Demucs 1.5 min + 对齐 40 s），一台 Mac mini 一次只跑一个任务
  queueMax: num("QUEUE_MAX", 20),
  dailyQuota: num("DAILY_QUOTA", 20),
  jobTimeoutMs: num("JOB_TIMEOUT_MS", 10 * 60_000),
  maxDurationSec: num("MAX_DURATION_SEC", 10 * 60),
  // 普通接口按 mid 限流；客户端每 3 s 轮询一次任务状态约 20 次/分，留足余量（同步服务曾因额度太紧整体停摆）
  rateLimitPerMinute: num("RATE_LIMIT_PER_MINUTE", 300),
  // B 站请求之间的最小间隔：加快会触发 -352 风控，风控窗口里继续请求只会延长惩罚
  bilibiliMinIntervalMs: num("BILIBILI_MIN_INTERVAL_MS", 3000),
};
