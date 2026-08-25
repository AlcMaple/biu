import type { IncomingMessage, ServerResponse } from "node:http";

import {
  WEB_CLIENT_LOG_MAX_BODY_BYTES,
  WEB_CLIENT_LOG_MAX_CONTEXT,
  WEB_CLIENT_LOG_MAX_ENTRIES,
  WEB_CLIENT_LOG_MAX_MESSAGE,
  WEB_CLIENT_LOG_PATH,
  WEB_CLIENT_LOG_SESSION_PATTERN,
  isWebClientLogLevel,
  redactWebClientLogText,
} from "../shared/web-client-log.js";
import { ClientLogStore } from "./client-log-store.js";
import {
  ProxyRequestError,
  firstHeader,
  isCrossSiteRequest,
  readProxyBody,
  sendProxyJson,
  type ProxyLogger,
  type ProxyNext,
} from "./proxy-common.js";

/**
 * 接收网页端回传的日志。
 *
 * 这是一个「谁都能 POST」的公开端点，所以按不可信输入对待：同源限定、体积上限、
 * 逐字段白名单与截断、按 IP 与全局双重限流。落盘的每一行都是服务端自己拼的对象，
 * 客户端字段只作为其中的值，不会污染结构。
 */

const MAX_USER_AGENT_LENGTH = 300;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_PER_IP = 60;
const RATE_LIMIT_GLOBAL = 3000;

export interface ClientLogHandlerOptions {
  clientIpHeader?: string;
  dir: string;
  logger?: ProxyLogger;
  maxTotalBytes?: number;
  now?: () => number;
  publicOrigin?: string;
  retentionDays?: number;
  store?: ClientLogStore;
}

export type ClientLogHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: ProxyNext,
) => Promise<boolean>;

const truncate = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit)}…[truncated]` : value;

/** 去掉控制字符：日志是给人读的纯文本，换行/回车会伪造出额外的日志行 */
// eslint-disable-next-line no-control-regex
const stripControlCharacters = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ");

const sanitizeText = (value: string, limit: number) =>
  redactWebClientLogText(truncate(stripControlCharacters(value), limit));

/** context 只保留能安全序列化的部分，超长直接截断成字符串 */
function sanitizeContext(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return undefined; // 含循环引用等：丢弃，不值得为它冒险
  }
  if (!serialized || serialized === "{}") return undefined;

  const safe = sanitizeText(serialized, WEB_CLIENT_LOG_MAX_CONTEXT);
  try {
    const parsed = JSON.parse(safe) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // 截断后不再是合法 JSON：退化成一个字符串字段，信息还在
  }
  return { raw: safe };
}

interface RateLimitBuckets {
  global: number[];
  perIp: Map<string, number[]>;
}

const prune = (timestamps: number[], cutoff: number) => {
  const firstActive = timestamps.findIndex(timestamp => timestamp > cutoff);
  if (firstActive === -1) timestamps.length = 0;
  else if (firstActive > 0) timestamps.splice(0, firstActive);
};

/**
 * 只有显式配置了可信客户端地址头时才启用每 IP 桶，
 * 否则反代部署会把所有用户误判成同一个 peer（与登录限流的取舍一致）。
 */
function trustedClientAddress(request: IncomingMessage, clientIpHeader: string | undefined) {
  if (!clientIpHeader) return undefined;
  const raw = firstHeader(request.headers[clientIpHeader.toLowerCase()]);
  const value = raw?.split(",")[0]?.trim();
  return value || undefined;
}

export function createClientLogHandler(options: ClientLogHandlerOptions): ClientLogHandler {
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;
  const store =
    options.store ??
    new ClientLogStore({
      dir: options.dir,
      maxTotalBytes: options.maxTotalBytes,
      now,
      retentionDays: options.retentionDays,
    });
  const buckets: RateLimitBuckets = { global: [], perIp: new Map() };

  const consumeRateLimit = (ip: string | undefined) => {
    const cutoff = now() - RATE_LIMIT_WINDOW_MS;
    prune(buckets.global, cutoff);
    for (const [key, timestamps] of buckets.perIp) {
      prune(timestamps, cutoff);
      if (timestamps.length === 0) buckets.perIp.delete(key);
    }

    if (buckets.global.length >= RATE_LIMIT_GLOBAL) return false;
    const ipTimestamps = ip ? (buckets.perIp.get(ip) ?? []) : undefined;
    if (ipTimestamps && ipTimestamps.length >= RATE_LIMIT_PER_IP) return false;

    buckets.global.push(now());
    if (ip && ipTimestamps) {
      ipTimestamps.push(now());
      buckets.perIp.set(ip, ipTimestamps);
    }
    return true;
  };

  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://biu.local");
    if (url.pathname !== WEB_CLIENT_LOG_PATH) {
      next?.();
      return false;
    }

    try {
      if ((request.method ?? "GET") !== "POST") {
        response.setHeader("Allow", "POST");
        throw new ProxyRequestError("client log method is not allowed", 405);
      }
      // 日志端点没有任何副作用，但仍限定同源，避免变成公开的写盘接口
      if (isCrossSiteRequest(request, options.publicOrigin)) {
        throw new ProxyRequestError("client log request must be same-origin", 403);
      }

      const ip = trustedClientAddress(request, options.clientIpHeader);
      if (!consumeRateLimit(ip)) throw new ProxyRequestError("too many client log requests", 429);

      const body = await readProxyBody(request, WEB_CLIENT_LOG_MAX_BODY_BYTES);
      let payload: unknown;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        throw new ProxyRequestError("client log payload was not valid JSON", 400);
      }

      const { entries, sessionId } = (payload ?? {}) as { entries?: unknown; sessionId?: unknown };
      if (!Array.isArray(entries)) throw new ProxyRequestError("client log payload is missing entries", 400);

      const receivedAt = new Date(now()).toISOString();
      const userAgent = sanitizeText(firstHeader(request.headers["user-agent"]) ?? "", MAX_USER_AGENT_LENGTH);
      const session =
        typeof sessionId === "string" && WEB_CLIENT_LOG_SESSION_PATTERN.test(sessionId) ? sessionId : undefined;

      const records = entries.slice(0, WEB_CLIENT_LOG_MAX_ENTRIES).flatMap(entry => {
        if (!entry || typeof entry !== "object") return [];
        const { at, context, level, message } = entry as Record<string, unknown>;
        if (!isWebClientLogLevel(level) || typeof message !== "string" || !message.trim()) return [];

        return [
          {
            // 服务端时间是权威时间；客户端时间另存，手机系统时间不可信
            receivedAt,
            clientAt: typeof at === "number" && Number.isFinite(at) ? new Date(at).toISOString() : undefined,
            level,
            message: sanitizeText(message, WEB_CLIENT_LOG_MAX_MESSAGE),
            context: sanitizeContext(context),
            sessionId: session,
            ip,
            userAgent: userAgent || undefined,
          },
        ];
      });

      if (records.length > 0) {
        void store.append(records);
      }
      sendProxyJson(response, 202, { code: 0, accepted: records.length });
      return true;
    } catch (error) {
      if (error instanceof ProxyRequestError) {
        sendProxyJson(response, error.status, { code: -error.status, message: error.message });
        return true;
      }
      logger.error("[web-log] client log request failed", error);
      sendProxyJson(response, 500, { code: -500, message: "client log request failed" });
      return true;
    }
  };
}
