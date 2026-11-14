import axios from "axios";
import jwt from "jsonwebtoken";

import { config } from "./config.js";

interface BilibiliNavResponse {
  code: number;
  data?: {
    isLogin?: boolean;
    mid?: number;
  };
}

export class InvalidCookieError extends Error {}

export class BilibiliUnavailableError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("B 站暂时拒绝验证登录态");
  }
}

// 所有用户的验证请求都从这台服务器的同一个出口 IP 发往 B 站。B 站一旦风控或出错，
// 继续逐个替客户端去问只会把整个 IP 打进黑名单，全站同步一起停摆；所以失败一次就全局
// 停手一段时间，冷却期内直接回绝，不再碰 B 站。已经换到 token 的设备不受影响（token 2 小时有效）。
const RISK_CONTROL_COOLDOWN_MS = 5 * 60_000;
const UPSTREAM_ERROR_COOLDOWN_MS = 60_000;
const RISK_CONTROL_CODES = new Set([-352, -412, -509, -799]);
let navBlockedUntil = 0;

function blockNav(ms: number, reason: string): BilibiliUnavailableError {
  console.warn(`[auth] B 站验证失败（${reason}），${ms / 1000}s 内不再请求 B 站`);
  navBlockedUntil = Date.now() + ms;
  return new BilibiliUnavailableError(Math.ceil(ms / 1000));
}

export function resetNavCooldownForTests() {
  navBlockedUntil = 0;
}

/**
 * 用客户端传来的 B 站 cookie 换取 mid —— 绝不信任客户端自己上报的 mid，
 * 永远以这次向 B 站官方接口验证拿到的为准。
 */
export async function resolveMidFromCookie(cookie: string): Promise<string> {
  const waitMs = navBlockedUntil - Date.now();
  if (waitMs > 0) throw new BilibiliUnavailableError(Math.ceil(waitMs / 1000));

  let res;
  try {
    res = await axios.get<BilibiliNavResponse>(config.bilibiliNavUrl, {
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
      },
      timeout: 8000,
    });
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    const riskControl = status === 412 || status === 429;
    throw blockNav(
      riskControl ? RISK_CONTROL_COOLDOWN_MS : UPSTREAM_ERROR_COOLDOWN_MS,
      status ? `HTTP ${status}` : (err as Error).message,
    );
  }

  if (RISK_CONTROL_CODES.has(res.data?.code)) throw blockNav(RISK_CONTROL_COOLDOWN_MS, `code ${res.data.code}`);

  const mid = res.data?.data?.mid;
  if (!res.data?.data?.isLogin || !mid) {
    throw new InvalidCookieError("cookie 未登录或已失效");
  }
  return String(mid);
}

export interface SyncTokenPayload {
  mid: string;
}

export function signToken(mid: string): string {
  return jwt.sign({ mid } satisfies SyncTokenPayload, config.jwtSecret, {
    expiresIn: config.jwtTtlSeconds,
  });
}

export function verifyToken(token: string): SyncTokenPayload {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (typeof decoded !== "object" || decoded === null || typeof (decoded as SyncTokenPayload).mid !== "string") {
    throw new Error("malformed token payload");
  }
  return decoded as SyncTokenPayload;
}
