import rateLimit from "express-rate-limit";

import type { AuthedRequest } from "./require-auth.js";

import { config } from "./config.js";

/**
 * 必须放在 requireAuth 之后使用，靠 req.mid 做 key —— 按用户限流而不是按 IP，
 * 因为同一公司/校园网出口 IP 可能有多个真实用户。
 */
export const syncRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.rateLimitPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => (req as AuthedRequest).mid ?? req.ip ?? "unknown",
});
