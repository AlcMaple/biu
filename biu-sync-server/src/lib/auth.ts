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

/**
 * 用客户端传来的 B 站 cookie 换取 mid —— 绝不信任客户端自己上报的 mid，
 * 永远以这次向 B 站官方接口验证拿到的为准。
 */
export async function resolveMidFromCookie(cookie: string): Promise<string> {
  const res = await axios.get<BilibiliNavResponse>("https://api.bilibili.com/x/web-interface/nav", {
    headers: {
      Cookie: cookie,
      "User-Agent": "Mozilla/5.0",
    },
    timeout: 8000,
  });

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
