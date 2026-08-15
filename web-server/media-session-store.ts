import type { IncomingMessage, ServerResponse } from "node:http";

import { createHash, randomBytes } from "node:crypto";

export const MEDIA_SESSION_COOKIE_NAME = "__Host-biu_media_session";
export const DEFAULT_MEDIA_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface MediaSessionRecord {
  expiresAt: number;
  lastAccessAt: number;
}

export interface MediaSessionStoreOptions {
  maxEntries?: number;
  now?: () => number;
  randomToken?: () => string;
  sessionTtlMs?: number;
}

const TOKEN_PATTERN = /^[-_0-9A-Za-z]{32,128}$/;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function cookieValue(cookieHeader: string, name: string) {
  for (const rawCookie of cookieHeader.split(";")) {
    const separator = rawCookie.indexOf("=");
    if (separator <= 0 || rawCookie.slice(0, separator).trim() !== name) continue;
    return rawCookie.slice(separator + 1).trim();
  }
  return undefined;
}

function appendSetCookie(response: ServerResponse, cookie: string) {
  const existing = response.getHeader("Set-Cookie");
  if (Array.isArray(existing)) response.setHeader("Set-Cookie", [...existing.map(String), cookie]);
  else if (existing !== undefined) response.setHeader("Set-Cookie", [String(existing), cookie]);
  else response.setHeader("Set-Cookie", cookie);
}

export class MediaSessionStore {
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly randomToken: () => string;
  private readonly sessionTtlMs: number;
  private readonly sessions = new Map<string, MediaSessionRecord>();

  constructor(options: MediaSessionStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? Date.now;
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_MEDIA_SESSION_TTL_MS;
  }

  resolve(request: Pick<IncomingMessage, "headers">): string | undefined {
    this.deleteExpired();
    const rawCookie = Array.isArray(request.headers.cookie)
      ? request.headers.cookie.join("; ")
      : request.headers.cookie;
    const token = cookieValue(rawCookie ?? "", MEDIA_SESSION_COOKIE_NAME);
    if (!token || !TOKEN_PATTERN.test(token)) return undefined;

    const sessionId = hashToken(token);
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.lastAccessAt = this.now();
    this.sessions.delete(sessionId);
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  resolveOrCreate(request: Pick<IncomingMessage, "headers">, response: ServerResponse): string {
    const existing = this.resolve(request);
    if (existing) return existing;

    while (this.sessions.size >= this.maxEntries) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (!oldest) break;
      this.sessions.delete(oldest);
    }

    const token = this.randomToken();
    if (!TOKEN_PATTERN.test(token)) throw new Error("generated media session token has an invalid shape");

    const now = this.now();
    const sessionId = hashToken(token);
    this.sessions.set(sessionId, { expiresAt: now + this.sessionTtlMs, lastAccessAt: now });
    appendSetCookie(
      response,
      `${MEDIA_SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(this.sessionTtlMs / 1000)}`,
    );
    return sessionId;
  }

  get size() {
    this.deleteExpired();
    return this.sessions.size;
  }

  private deleteExpired() {
    const now = this.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(sessionId);
    }
  }
}
