/**
 * 网页端 → 同源服务的日志回传
 */

export const WEB_CLIENT_LOG_PATH = "/__biu_log";

export type WebClientLogLevel = "error" | "warn" | "info";

export interface WebClientLogEntry {
  /** 客户端时间戳（毫秒） */
  at: number;
  context?: Record<string, unknown>;
  level: WebClientLogLevel;
  message: string;
}

export interface WebClientLogPayload {
  entries: WebClientLogEntry[];
  /** 每个标签页一个随机 id，用于把同一次会话的多条日志串起来（不含任何账号信息） */
  sessionId: string;
}

/** 单批最多条数：超出的在客户端就丢弃，避免把日志接口当成上传通道 */
export const WEB_CLIENT_LOG_MAX_ENTRIES = 20;
/** 单条消息最大长度 */
export const WEB_CLIENT_LOG_MAX_MESSAGE = 2000;
/** 单条 context 序列化后的最大长度 */
export const WEB_CLIENT_LOG_MAX_CONTEXT = 4000;
/** 请求体上限，服务端按此拒绝超大 body */
export const WEB_CLIENT_LOG_MAX_BODY_BYTES = 32 * 1024;
/** sessionId 形状：客户端生成的随机串 */
export const WEB_CLIENT_LOG_SESSION_PATTERN = /^[-_0-9A-Za-z]{8,64}$/;

const LEVELS = new Set<WebClientLogLevel>(["error", "warn", "info"]);

export function isWebClientLogLevel(value: unknown): value is WebClientLogLevel {
  return typeof value === "string" && LEVELS.has(value as WebClientLogLevel);
}

/**
 * 抹掉日志里的媒体代理 token
 *
 * `/__biu_proxy/bilibili/media/<token>` 里的 token 是能直接换到 B 站媒体流的凭据
 */
export function redactWebClientLogText(value: string): string {
  return value
    .replace(/(\/__biu_proxy\/bilibili\/media\/)[-_0-9A-Za-z]{8,128}/g, "$1<redacted>")
    .replace(/([?&](?:SESSDATA|bili_jct|access_key|token|refresh_token)=)[^&\s]+/gi, "$1<redacted>");
}
