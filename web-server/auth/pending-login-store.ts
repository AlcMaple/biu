import { createHash, randomBytes } from "node:crypto";

export const DEFAULT_PENDING_LOGIN_TTL_MS = 3 * 60 * 1000;
export const DEFAULT_PENDING_LOGIN_LIMIT = 500;
export const WEB_LOGIN_COOKIE_NAME = "__Host-biu_login";
const LOGIN_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const BROWSER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export class PendingLoginCapacityError extends Error {
  constructor() {
    super("too many pending QR login transactions");
  }
}

export interface PendingLogin {
  authCode: string;
  browserBindingHash: string;
  expiresAt: number;
  polling: boolean;
}

export interface PendingLoginStoreOptions {
  maxEntries?: number;
  now?: () => number;
  randomBrowserToken?: () => string;
  randomId?: () => string;
  ttlMs?: number;
}

const hashLoginId = (loginId: string) => createHash("sha256").update(loginId).digest("hex");

export function serializeWebLoginCookie(token: string, maxAgeSeconds: number): string {
  return `${WEB_LOGIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}

export function serializeClearedWebLoginCookie(): string {
  return `${WEB_LOGIN_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export class PendingLoginStore {
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly randomBrowserToken: () => string;
  private readonly randomId: () => string;
  private readonly ttlMs: number;
  private readonly pending = new Map<string, PendingLogin>();

  constructor(options: PendingLoginStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_PENDING_LOGIN_LIMIT;
    this.now = options.now ?? Date.now;
    this.randomBrowserToken = options.randomBrowserToken ?? (() => randomBytes(32).toString("base64url"));
    this.randomId = options.randomId ?? (() => randomBytes(24).toString("base64url"));
    this.ttlMs = options.ttlMs ?? DEFAULT_PENDING_LOGIN_TTL_MS;
  }

  create(authCode: string): { browserToken: string; expiresAt: number; loginId: string } {
    this.deleteExpired();
    if (this.pending.size >= this.maxEntries) throw new PendingLoginCapacityError();

    const loginId = this.randomId();
    if (!LOGIN_ID_PATTERN.test(loginId)) throw new Error("generated QR login id has an invalid shape");
    const browserToken = this.randomBrowserToken();
    if (!BROWSER_TOKEN_PATTERN.test(browserToken)) throw new Error("generated QR browser token has an invalid shape");

    const expiresAt = this.now() + this.ttlMs;
    this.pending.set(hashLoginId(loginId), {
      authCode,
      browserBindingHash: hashLoginId(browserToken),
      expiresAt,
      polling: false,
    });
    return { browserToken, expiresAt, loginId };
  }

  get size(): number {
    this.deleteExpired();
    return this.pending.size;
  }

  claim(
    loginId: string,
    browserToken: string | undefined,
  ):
    | { pending: PendingLogin; status: "ok" }
    | { status: "binding-mismatch" }
    | { status: "busy" }
    | { status: "expired" }
    | { status: "missing" } {
    if (!LOGIN_ID_PATTERN.test(loginId)) return { status: "missing" };

    const key = hashLoginId(loginId);
    const pending = this.pending.get(key);
    if (!pending) return { status: "missing" };
    if (pending.expiresAt <= this.now()) {
      this.pending.delete(key);
      return { status: "expired" };
    }
    if (!browserToken || !BROWSER_TOKEN_PATTERN.test(browserToken)) return { status: "binding-mismatch" };
    if (pending.browserBindingHash !== hashLoginId(browserToken)) return { status: "binding-mismatch" };
    if (pending.polling) return { status: "busy" };

    pending.polling = true;
    return { pending, status: "ok" };
  }

  clearBrowser(browserToken: string | undefined): void {
    if (!browserToken || !BROWSER_TOKEN_PATTERN.test(browserToken)) return;

    const bindingHash = hashLoginId(browserToken);
    for (const [key, pending] of this.pending) {
      if (pending.browserBindingHash === bindingHash) this.pending.delete(key);
    }
  }

  release(loginId: string, consume = false): void {
    if (!LOGIN_ID_PATTERN.test(loginId)) return;

    const key = hashLoginId(loginId);
    if (consume) this.pending.delete(key);
    else {
      const pending = this.pending.get(key);
      if (pending) pending.polling = false;
    }
  }

  private deleteExpired() {
    const now = this.now();
    for (const [key, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(key);
    }
  }
}
