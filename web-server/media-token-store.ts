import { randomBytes } from "node:crypto";

import { BILIBILI_MEDIA_PROXY_PREFIX } from "../shared/bilibili-web-proxy.js";
import { isAllowedBilibiliMediaUrl } from "./routes.js";

export const DEFAULT_MEDIA_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

interface MediaTokenRecord {
  expiresAt: number;
  sessionId: string;
  target: string;
}

export interface MediaTokenStoreOptions {
  maxEntries?: number;
  now?: () => number;
  randomToken?: () => string;
  tokenTtlMs?: number;
}

const TOKEN_PATTERN = /^[-_0-9A-Za-z]{32,128}$/;

function targetExpiry(target: URL, now: number, fallbackTtlMs: number) {
  const rawDeadline = target.searchParams.get("deadline");
  if (!rawDeadline) return now + fallbackTtlMs;

  const deadlineSeconds = Number(rawDeadline);
  if (!Number.isFinite(deadlineSeconds)) return now + fallbackTtlMs;
  return Math.min(deadlineSeconds * 1000, now + fallbackTtlMs);
}

export class MediaTokenStore {
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly randomToken: () => string;
  private readonly tokenTtlMs: number;
  private readonly tokens = new Map<string, MediaTokenRecord>();

  constructor(options: MediaTokenStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? Date.now;
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
    this.tokenTtlMs = options.tokenTtlMs ?? DEFAULT_MEDIA_TOKEN_TTL_MS;
  }

  register(target: string, sessionId: string): string | undefined {
    if (!isAllowedBilibiliMediaUrl(target)) return undefined;
    this.deleteExpired();

    const now = this.now();
    const expiresAt = targetExpiry(new URL(target), now, this.tokenTtlMs);
    if (expiresAt <= now) return undefined;

    while (this.tokens.size >= this.maxEntries) {
      const oldest = this.tokens.keys().next().value as string | undefined;
      if (!oldest) break;
      this.tokens.delete(oldest);
    }

    let token = this.randomToken();
    if (!TOKEN_PATTERN.test(token)) throw new Error("generated media proxy token has an invalid shape");
    while (this.tokens.has(token)) token = this.randomToken();

    this.tokens.set(token, { expiresAt, sessionId, target });
    return `${BILIBILI_MEDIA_PROXY_PREFIX}/${token}`;
  }

  resolve(token: string, sessionId: string): URL | undefined {
    if (!TOKEN_PATTERN.test(token)) return undefined;

    const record = this.tokens.get(token);
    if (!record) return undefined;
    if (record.expiresAt <= this.now()) {
      this.tokens.delete(token);
      return undefined;
    }
    if (record.sessionId !== sessionId) return undefined;
    if (!isAllowedBilibiliMediaUrl(record.target)) {
      this.tokens.delete(token);
      return undefined;
    }

    return new URL(record.target);
  }

  get size() {
    this.deleteExpired();
    return this.tokens.size;
  }

  private deleteExpired() {
    const now = this.now();
    for (const [token, record] of this.tokens) {
      if (record.expiresAt <= now) this.tokens.delete(token);
    }
  }
}
