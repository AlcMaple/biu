import type { IncomingMessage } from "node:http";

import { createHash, randomBytes } from "node:crypto";

import type { BiuMonitoringUser } from "../../shared/monitoring-user.js";
import type { SessionPersistence } from "./session-persistence.js";

export const WEB_SESSION_COOKIE_NAME = "__Host-biu_session";
/**
 * 滑动有效期：每次使用都顺延，只有连续这么久没打开才会失效。
 * 取 180 天与 B 站 SESSDATA 的有效期同量级；Cookie 状态检查（session-refresh）会负责续期上游 Cookie。
 */
export const DEFAULT_WEB_SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** 服务端顺延 / 落盘的最小间隔：避免每个请求都写盘 */
const TOUCH_PERSIST_INTERVAL_MS = 10 * 60 * 1000;
/** 浏览器 Cookie 重新下发（刷新 Max-Age）的最小间隔 */
const COOKIE_RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 2000;

export interface BilibiliCookie {
  domain: string;
  hostOnly: boolean;
  name: string;
  path: string;
  value: string;
  expiresAt?: number;
}

export interface WebSessionRecord {
  cookies: Map<string, BilibiliCookie>;
  createdAt: number;
  expiresAt: number;
  lastAccessAt: number;
  /** 上次向浏览器重新下发会话 Cookie 的时间（滑动续期用） */
  cookieRenewedAt?: number;
  lastRefreshCheckAt: number;
  refreshToken?: string;
  user?: BiuMonitoringUser;
}

export interface ResolvedWebSessionRecord {
  sessionId: string;
  session: WebSessionRecord;
}

export interface WebSessionStoreOptions {
  now?: () => number;
  randomToken?: () => string;
  sessionTtlMs?: number;
}

type RequestWithHeaders = Pick<IncomingMessage, "headers">;

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function hasUnsafeCookiePathCharacter(path: string): boolean {
  for (const character of path) {
    const codePoint = character.charCodeAt(0);
    if (character === ";" || codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function requestCookieHeader(request: RequestWithHeaders): string {
  const header = request.headers.cookie;
  return Array.isArray(header) ? header.join("; ") : (header ?? "");
}

export function hasWebSessionCookie(request: RequestWithHeaders): boolean {
  return parseCookieHeader(requestCookieHeader(request)).has(WEB_SESSION_COOKIE_NAME);
}

export function parseCookieHeader(header: string): Map<string, string> {
  const cookies = new Map<string, string>();

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies.set(name, value);
  }

  return cookies;
}

function sanitizeBilibiliCookie(cookie: BilibiliCookie): BilibiliCookie | undefined {
  if (typeof cookie.domain !== "string" || typeof cookie.path !== "string" || typeof cookie.hostOnly !== "boolean") {
    return undefined;
  }
  if (typeof cookie.name !== "string" || typeof cookie.value !== "string") return undefined;
  if (!COOKIE_NAME_PATTERN.test(cookie.name)) return undefined;
  if (/[;\r\n\0]/.test(cookie.value)) return undefined;
  const domain = cookie.domain.toLowerCase().replace(/^\.+/, "").replace(/\.$/, "");
  if (domain !== "bilibili.com" && !domain.endsWith(".bilibili.com")) return undefined;
  if (!cookie.path.startsWith("/") || hasUnsafeCookiePathCharacter(cookie.path)) return undefined;

  return {
    domain,
    hostOnly: cookie.hostOnly,
    name: cookie.name,
    path: cookie.path,
    value: cookie.value,
    ...(Number.isFinite(cookie.expiresAt) ? { expiresAt: cookie.expiresAt } : {}),
  };
}

// A host-only cookie and a Domain cookie may legally share the same name,
// domain text, and path. Keep their scope in the identity so an update from
// one upstream origin cannot silently replace the other.
const cookieIdentity = (cookie: Pick<BilibiliCookie, "domain" | "hostOnly" | "name" | "path">) =>
  `${cookie.hostOnly ? "host" : "domain"}\0${cookie.domain}\0${cookie.path}\0${cookie.name}`;

function cloneCookies(cookies: Iterable<BilibiliCookie>, now = Date.now()): Map<string, BilibiliCookie> {
  const cloned = new Map<string, BilibiliCookie>();
  for (const rawCookie of cookies) {
    const cookie = sanitizeBilibiliCookie(rawCookie);
    if (cookie?.value && (cookie.expiresAt === undefined || cookie.expiresAt > now)) {
      cloned.set(cookieIdentity(cookie), cookie);
    }
  }
  return cloned;
}

export function mergeBilibiliCookies(
  current: Iterable<BilibiliCookie>,
  updates: Iterable<BilibiliCookie>,
  now = Date.now(),
): Map<string, BilibiliCookie> {
  const merged = cloneCookies(current, now);

  for (const rawCookie of updates) {
    const cookie = sanitizeBilibiliCookie(rawCookie);
    if (!cookie) continue;

    const identity = cookieIdentity(cookie);
    if (!cookie.value || (cookie.expiresAt !== undefined && cookie.expiresAt <= now)) merged.delete(identity);
    else merged.set(identity, cookie);
  }

  return merged;
}

function cookieDomainMatches(cookie: BilibiliCookie, hostname: string): boolean {
  return cookie.hostOnly
    ? hostname === cookie.domain
    : hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`);
}

function cookiePathMatches(cookiePath: string, requestPath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/";
}

export function selectBilibiliCookies(
  cookies: Iterable<BilibiliCookie>,
  target: string | URL,
  now = Date.now(),
): BilibiliCookie[] {
  const url = target instanceof URL ? target : new URL(target);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const requestPath = url.pathname || "/";

  return [...cookies]
    .filter(cookie => cookie.expiresAt === undefined || cookie.expiresAt > now)
    .filter(cookie => Boolean(cookie.value))
    .filter(cookie => cookieDomainMatches(cookie, hostname) && cookiePathMatches(cookie.path, requestPath))
    .sort(
      (left, right) =>
        right.path.length - left.path.length ||
        Number(right.hostOnly) - Number(left.hostOnly) ||
        left.name.localeCompare(right.name),
    );
}

export function findBilibiliCookie(
  cookies: Iterable<BilibiliCookie>,
  name: string,
  target: string | URL,
  now = Date.now(),
): BilibiliCookie | undefined {
  return selectBilibiliCookies(cookies, target, now).find(cookie => cookie.name === name);
}

export function formatBilibiliCookieHeader(
  cookies: Iterable<BilibiliCookie>,
  target: string | URL,
  now = Date.now(),
): string {
  return selectBilibiliCookies(cookies, target, now)
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export function serializeWebSessionCookie(token: string, maxAgeSeconds: number): string {
  return `${WEB_SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}

export function serializeClearedWebSessionCookie(): string {
  return `${WEB_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/**
 * 浏览器只持有随机会话标识；B 站 Cookie 与 refresh_token 始终留在这个服务端 store。
 * Map 的 key 是标识的 SHA-256，不在服务端内存里保存浏览器持有的原始 token。
 */
export class WebSessionStore {
  private readonly now: () => number;
  private readonly randomToken: () => string;
  private readonly sessionTtlMs: number;
  private readonly sessions = new Map<string, WebSessionRecord>();
  private persistence?: SessionPersistence;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private persistChain: Promise<void> = Promise.resolve();
  private dirty = false;

  /** 挂载磁盘持久化：先载入已有会话，之后任何变更都防抖落盘。 */
  async enablePersistence(persistence: SessionPersistence): Promise<number> {
    const entries = (await persistence.load()) ?? [];
    const now = this.now();
    for (const entry of entries) {
      const restored = restoreEntry(entry, now);
      if (restored) this.sessions.set(restored.key, restored.record);
    }
    this.persistence = persistence;
    return this.sessions.size;
  }

  /** 立即把待写入的变更落盘（进程退出前调用）。 */
  async flush(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    if (!this.persistence || !this.dirty) return this.persistChain;
    this.dirty = false;
    const persistence = this.persistence;
    const entries = [...this.sessions].map(([key, record]) => serializeEntry(key, record));
    this.persistChain = this.persistChain
      .then(() => persistence.save(entries))
      .catch(error => {
        this.dirty = true;
        console.warn("[web-auth] failed to persist sessions", error);
      });
    return this.persistChain;
  }

  private markDirty() {
    if (!this.persistence) return;
    this.dirty = true;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.flush();
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }

  /** 该会话的浏览器 Cookie 是否到了重新下发的时间（让浏览器端 Max-Age 也滑动）。 */
  consumeCookieRenewal(session: WebSessionRecord): { maxAgeSeconds: number } | undefined {
    const now = this.now();
    if (session.cookieRenewedAt !== undefined && now - session.cookieRenewedAt < COOKIE_RENEW_INTERVAL_MS) {
      return undefined;
    }
    session.cookieRenewedAt = now;
    this.markDirty();
    return { maxAgeSeconds: this.sessionTtlMs / 1000 };
  }

  constructor(options: WebSessionStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_WEB_SESSION_TTL_MS;
  }

  createSession(input: { cookies: Iterable<BilibiliCookie>; refreshToken?: string; user?: BiuMonitoringUser }): {
    cookieHeader: string;
    sessionId: string;
  } {
    this.deleteExpired();

    const token = this.randomToken();
    if (!SESSION_TOKEN_PATTERN.test(token)) throw new Error("generated Web session token has an invalid shape");

    const now = this.now();
    const sessionId = hashToken(token);
    this.sessions.set(sessionId, {
      cookies: cloneCookies(input.cookies, now),
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
      lastAccessAt: now,
      // QR 登录刚经过一次服务端身份校验，可从这里开始计算下一次 Cookie 状态检查。
      lastRefreshCheckAt: now,
      cookieRenewedAt: now,
      refreshToken: input.refreshToken,
      ...(input.user ? { user: input.user } : {}),
    });
    this.markDirty();

    return {
      cookieHeader: serializeWebSessionCookie(token, this.sessionTtlMs / 1000),
      sessionId,
    };
  }

  resolveSessionRecord(request: RequestWithHeaders): ResolvedWebSessionRecord | undefined {
    const token = parseCookieHeader(requestCookieHeader(request)).get(WEB_SESSION_COOKIE_NAME);
    if (!token || !SESSION_TOKEN_PATTERN.test(token)) return undefined;

    const key = hashToken(token);
    const session = this.sessions.get(key);
    if (!session) return undefined;

    const now = this.now();
    if (session.expiresAt <= now) {
      this.sessions.delete(key);
      this.markDirty();
      return undefined;
    }

    // 滑动有效期：用一次顺延一次；落盘节流，避免每个请求都写盘
    if (now - session.lastAccessAt >= TOUCH_PERSIST_INTERVAL_MS) this.markDirty();
    session.lastAccessAt = now;
    session.expiresAt = now + this.sessionTtlMs;
    return { session, sessionId: key };
  }

  getSession(request: RequestWithHeaders): WebSessionRecord | undefined {
    return this.resolveSessionRecord(request)?.session;
  }

  resolveCookieFor(request: RequestWithHeaders, target: string | URL): string | undefined {
    const session = this.getSession(request);
    if (!session) return undefined;

    const cookie = formatBilibiliCookieHeader(session.cookies.values(), target, this.now());
    return cookie || undefined;
  }

  updateSession(
    request: RequestWithHeaders,
    update: { cookies?: Iterable<BilibiliCookie>; refreshToken?: string; user?: BiuMonitoringUser | null },
  ): boolean {
    const session = this.getSession(request);
    if (!session) return false;

    if (update.cookies) session.cookies = mergeBilibiliCookies(session.cookies.values(), update.cookies, this.now());
    if (update.refreshToken !== undefined) session.refreshToken = update.refreshToken;
    if (update.user !== undefined) session.user = update.user ?? undefined;
    this.markDirty();
    return true;
  }

  updateSessionById(
    sessionId: string,
    update: { cookies?: Iterable<BilibiliCookie>; refreshToken?: string; user?: BiuMonitoringUser | null },
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= this.now()) {
      if (this.sessions.delete(sessionId)) this.markDirty();
      return false;
    }

    if (update.cookies) session.cookies = mergeBilibiliCookies(session.cookies.values(), update.cookies, this.now());
    if (update.refreshToken !== undefined) session.refreshToken = update.refreshToken;
    if (update.user !== undefined) session.user = update.user ?? undefined;
    this.markDirty();
    return true;
  }

  destroySession(request: RequestWithHeaders): boolean {
    const token = parseCookieHeader(requestCookieHeader(request)).get(WEB_SESSION_COOKIE_NAME);
    if (!token || !SESSION_TOKEN_PATTERN.test(token)) return false;
    const removed = this.sessions.delete(hashToken(token));
    if (removed) this.markDirty();
    return removed;
  }

  destroySessionById(sessionId: string): boolean {
    const removed = this.sessions.delete(sessionId);
    if (removed) this.markDirty();
    return removed;
  }

  get size(): number {
    this.deleteExpired();
    return this.sessions.size;
  }

  private deleteExpired() {
    const now = this.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(key);
        this.markDirty();
      }
    }
  }
}

interface PersistedEntry {
  key: string;
  record: Omit<WebSessionRecord, "cookies"> & { cookies: BilibiliCookie[] };
}

function serializeEntry(key: string, record: WebSessionRecord): PersistedEntry {
  return { key, record: { ...record, cookies: [...record.cookies.values()] } };
}

function restoreEntry(entry: unknown, now: number): { key: string; record: WebSessionRecord } | undefined {
  const { key, record } = (entry ?? {}) as Partial<PersistedEntry>;
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key) || !record || typeof record !== "object") return undefined;
  if (typeof record.expiresAt !== "number" || record.expiresAt <= now || !Array.isArray(record.cookies))
    return undefined;
  return { key, record: { ...record, cookies: cloneCookies(record.cookies, now) } };
}
