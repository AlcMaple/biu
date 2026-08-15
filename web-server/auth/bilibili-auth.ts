import { createHash, createPublicKey, publicEncrypt } from "node:crypto";

import {
  type BilibiliCookie,
  type WebSessionRecord,
  findBilibiliCookie,
  formatBilibiliCookieHeader,
  mergeBilibiliCookies,
} from "./session-store.js";

const PASSPORT_ORIGIN = "https://passport.bilibili.com";
const API_ORIGIN = "https://api.bilibili.com";
const WWW_ORIGIN = "https://www.bilibili.com";

const TV_APP_KEY = "4409e2ce8ffd12b8";
const TV_APP_SECRET = "59b43e04ad6965f34319062b478f83dd";
const REQUEST_TIMEOUT_MS = 10_000;

const CORRESPOND_PUBLIC_KEY = {
  kty: "RSA",
  n: "y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE",
  e: "AQAB",
} as const;

export const BILIBILI_AUTH_REQUEST_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Origin: WWW_ORIGIN,
  Referer: `${WWW_ORIGIN}/`,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
} as const;

interface UpstreamEnvelope<T> {
  code: number;
  data?: T | null;
  message?: string;
}

interface TvQrData {
  auth_code: string;
  url: string;
}

interface TvPollData {
  cookie_info?: {
    cookies?: Array<{
      expires?: number;
      name?: string;
      value?: string;
    }>;
  };
  mid?: number;
  refresh_token?: string;
}

export interface BilibiliUser {
  isLogin: boolean;
  mid: number;
  [key: string]: unknown;
}

export interface TvQrResult {
  authCode: string;
  url: string;
}

export interface TvPollResult {
  code: number;
  cookies: BilibiliCookie[];
  message: string;
  mid?: number;
  refreshToken?: string;
}

export interface RefreshResult {
  cookies: Map<string, BilibiliCookie>;
  refreshToken?: string;
  refreshed: boolean;
}

export interface BilibiliAuthClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

export class BilibiliUpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function splitSetCookieHeader(header: string): string[] {
  return header.split(/,(?=\s*[^;,\s]+=)/g).map(value => value.trim());
}

export function readSetCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(headers);

  const combined = headers.get("set-cookie");
  return combined ? splitSetCookieHeader(combined) : [];
}

function defaultCookiePath(pathname: string): string {
  if (!pathname.startsWith("/") || pathname === "/") return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function parseBilibiliSetCookie(
  header: string,
  responseUrl: string | URL,
  now = Date.now(),
): BilibiliCookie | undefined {
  const source = responseUrl instanceof URL ? responseUrl : new URL(responseUrl);
  const sourceHostname = source.hostname.toLowerCase().replace(/\.$/, "");
  if (sourceHostname !== "bilibili.com" && !sourceHostname.endsWith(".bilibili.com")) return undefined;
  const parts = header.split(";").map(part => part.trim());
  const first = parts.shift();
  if (!first) return undefined;

  const separator = first.indexOf("=");
  if (separator <= 0) return undefined;

  const cookie: BilibiliCookie = {
    domain: sourceHostname,
    hostOnly: true,
    name: first.slice(0, separator),
    path: defaultCookiePath(source.pathname),
    value: first.slice(separator + 1),
  };
  let declaredDomain: string | undefined;

  for (const attribute of parts) {
    const attributeSeparator = attribute.indexOf("=");
    const name = (attributeSeparator < 0 ? attribute : attribute.slice(0, attributeSeparator)).toLowerCase();
    const value = attributeSeparator < 0 ? "" : attribute.slice(attributeSeparator + 1);

    if (name === "max-age") {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) cookie.expiresAt = now + seconds * 1000;
    } else if (name === "expires" && cookie.expiresAt === undefined) {
      const expiresAt = Date.parse(value);
      if (Number.isFinite(expiresAt)) cookie.expiresAt = expiresAt;
    } else if (name === "domain") {
      declaredDomain = value.toLowerCase().replace(/^\.+/, "").replace(/\.$/, "");
    } else if (name === "path" && value.startsWith("/")) {
      cookie.path = value;
    }
  }

  if (declaredDomain) {
    const allowedDomain = declaredDomain === "bilibili.com" || declaredDomain.endsWith(".bilibili.com");
    if (!allowedDomain || !domainMatches(sourceHostname, declaredDomain)) return undefined;
    cookie.domain = declaredDomain;
    cookie.hostOnly = false;
  }

  return cookie;
}

function responseCookies(response: Response, responseUrl: string | URL, now: number): BilibiliCookie[] {
  return readSetCookieHeaders(response.headers)
    .map(header => parseBilibiliSetCookie(header, responseUrl, now))
    .filter((cookie): cookie is BilibiliCookie => Boolean(cookie));
}

function tvBodyCookies(data: TvPollData | null | undefined): BilibiliCookie[] {
  return (data?.cookie_info?.cookies ?? [])
    .filter(
      (cookie): cookie is { expires?: number; name: string; value: string } =>
        typeof cookie.name === "string" && typeof cookie.value === "string",
    )
    .map(cookie => ({
      domain: "bilibili.com",
      hostOnly: false,
      name: cookie.name,
      path: "/",
      value: cookie.value,
      ...(cookie.expires && cookie.expires > 0 ? { expiresAt: cookie.expires * 1000 } : {}),
    }));
}

function signTvParams(params: Record<string, string>, now: number): URLSearchParams {
  const common = {
    ...params,
    appkey: TV_APP_KEY,
    local_id: "0",
    ts: String(Math.floor(now / 1000)),
  };
  const query = new URLSearchParams(Object.entries(common).sort(([left], [right]) => left.localeCompare(right)));
  const signature = createHash("md5").update(`${query.toString()}${TV_APP_SECRET}`).digest("hex");
  query.set("sign", signature);
  return query;
}

function requestHeaders(cookie?: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    ...BILIBILI_AUTH_REQUEST_HEADERS,
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  };
}

async function readEnvelope<T>(response: Response): Promise<UpstreamEnvelope<T>> {
  if (!response.ok)
    throw new BilibiliUpstreamError(`Bilibili upstream returned HTTP ${response.status}`, response.status);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) throw new BilibiliUpstreamError("Bilibili upstream returned a non-JSON response");

  return (await response.json()) as UpstreamEnvelope<T>;
}

function getCorrespondPath(timestamp: number): string {
  const key = createPublicKey({ format: "jwk", key: CORRESPOND_PUBLIC_KEY });
  return publicEncrypt({ key, oaepHash: "sha256" }, Buffer.from(`refresh_${timestamp}`)).toString("hex");
}

function getRefreshCsrf(html: string): string | undefined {
  const match = html.match(/<div[^>]+id=["']1-name["'][^>]*>([^<]+)<\/div>/i);
  return match?.[1]?.trim() || undefined;
}

export class BilibiliAuthClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: BilibiliAuthClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async createQrCode(): Promise<TvQrResult> {
    const response = await this.fetchImpl(`${PASSPORT_ORIGIN}/x/passport-tv-login/qrcode/auth_code`, {
      method: "POST",
      headers: requestHeaders(undefined, { "Content-Type": "application/x-www-form-urlencoded" }),
      body: signTvParams({}, this.now()),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const envelope = await readEnvelope<TvQrData>(response);
    if (envelope.code !== 0 || !envelope.data?.auth_code || !envelope.data.url) {
      throw new BilibiliUpstreamError(envelope.message || `Bilibili QR generation failed (${envelope.code})`);
    }

    return { authCode: envelope.data.auth_code, url: envelope.data.url };
  }

  async pollQrCode(authCode: string): Promise<TvPollResult> {
    const pollUrl = new URL("/x/passport-tv-login/qrcode/poll", PASSPORT_ORIGIN);
    const response = await this.fetchImpl(pollUrl, {
      method: "POST",
      headers: requestHeaders(undefined, { "Content-Type": "application/x-www-form-urlencoded" }),
      body: signTvParams({ auth_code: authCode }, this.now()),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const envelope = await readEnvelope<TvPollData>(response);
    const cookies = mergeBilibiliCookies(
      responseCookies(response, pollUrl, this.now()),
      tvBodyCookies(envelope.data),
      this.now(),
    );

    return {
      code: envelope.code,
      cookies: [...cookies.values()],
      message: envelope.message ?? "",
      mid: envelope.data?.mid,
      refreshToken: envelope.data?.refresh_token,
    };
  }

  async getUser(cookies: Iterable<BilibiliCookie>): Promise<BilibiliUser> {
    const target = new URL("/x/web-interface/nav", API_ORIGIN);
    const cookie = formatBilibiliCookieHeader(cookies, target, this.now());
    const response = await this.fetchImpl(target, {
      headers: requestHeaders(cookie),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const envelope = await readEnvelope<BilibiliUser>(response);
    if (envelope.code !== 0 || !envelope.data?.isLogin || !envelope.data.mid) {
      throw new BilibiliUpstreamError("Bilibili session is no longer logged in", 401);
    }
    return envelope.data;
  }

  async refreshSession(session: WebSessionRecord): Promise<RefreshResult> {
    const infoUrl = new URL("/x/passport-login/web/cookie/info", PASSPORT_ORIGIN);
    let workingCookies = new Map(session.cookies);
    const currentCookie = formatBilibiliCookieHeader(workingCookies.values(), infoUrl, this.now());
    const csrf = findBilibiliCookie(workingCookies.values(), "bili_jct", infoUrl, this.now())?.value;
    if (csrf) infoUrl.searchParams.set("csrf", csrf);

    const infoResponse = await this.fetchImpl(infoUrl, {
      headers: requestHeaders(currentCookie),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const info = await readEnvelope<{ refresh?: boolean; timestamp?: number }>(infoResponse);
    workingCookies = mergeBilibiliCookies(
      workingCookies.values(),
      responseCookies(infoResponse, infoUrl, this.now()),
      this.now(),
    );
    if (info.code === -101) throw new BilibiliUpstreamError("Bilibili session is no longer logged in", 401);
    if (info.code !== 0) throw new BilibiliUpstreamError(info.message || `Cookie status check failed (${info.code})`);
    if (!info.data?.refresh) {
      return { cookies: workingCookies, refreshToken: session.refreshToken, refreshed: false };
    }
    if (!info.data.timestamp || !session.refreshToken) {
      throw new BilibiliUpstreamError("Bilibili session cannot be refreshed; please log in again", 409);
    }

    const correspondPath = getCorrespondPath(info.data.timestamp);
    const correspondUrl = new URL(`/correspond/1/${correspondPath}`, WWW_ORIGIN);
    const correspondResponse = await this.fetchImpl(correspondUrl, {
      headers: requestHeaders(formatBilibiliCookieHeader(workingCookies.values(), correspondUrl, this.now()), {
        Accept: "text/html,application/xhtml+xml",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!correspondResponse.ok) {
      throw new BilibiliUpstreamError(
        `Bilibili refresh challenge returned HTTP ${correspondResponse.status}`,
        correspondResponse.status,
      );
    }

    workingCookies = mergeBilibiliCookies(
      workingCookies.values(),
      responseCookies(correspondResponse, correspondUrl, this.now()),
      this.now(),
    );

    const refreshCsrf = getRefreshCsrf(await correspondResponse.text());
    if (!refreshCsrf) throw new BilibiliUpstreamError("Bilibili refresh challenge did not contain a token");

    const refreshUrl = new URL("/x/passport-login/web/cookie/refresh", PASSPORT_ORIGIN);
    const refreshRequestCsrf = findBilibiliCookie(workingCookies.values(), "bili_jct", refreshUrl, this.now())?.value;
    const refreshForm = new URLSearchParams({
      csrf: refreshRequestCsrf ?? "",
      refresh_csrf: refreshCsrf,
      refresh_token: session.refreshToken,
      source: "main_web",
    });
    const refreshResponse = await this.fetchImpl(refreshUrl, {
      method: "POST",
      headers: requestHeaders(formatBilibiliCookieHeader(workingCookies.values(), refreshUrl, this.now()), {
        "Content-Type": "application/x-www-form-urlencoded",
      }),
      body: refreshForm,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const refresh = await readEnvelope<{ refresh_token?: string }>(refreshResponse);
    if (refresh.code !== 0 || !refresh.data?.refresh_token) {
      throw new BilibiliUpstreamError(refresh.message || `Bilibili Cookie refresh failed (${refresh.code})`);
    }

    workingCookies = mergeBilibiliCookies(
      workingCookies.values(),
      responseCookies(refreshResponse, refreshUrl, this.now()),
      this.now(),
    );
    const confirmUrl = new URL("/x/passport-login/web/confirm/refresh", PASSPORT_ORIGIN);
    const refreshedCookieHeader = formatBilibiliCookieHeader(workingCookies.values(), confirmUrl, this.now());
    const refreshedCsrf = findBilibiliCookie(workingCookies.values(), "bili_jct", confirmUrl, this.now())?.value;
    const confirmForm = new URLSearchParams({
      csrf: refreshedCsrf ?? "",
      refresh_token: session.refreshToken,
    });
    const confirmResponse = await this.fetchImpl(confirmUrl, {
      method: "POST",
      headers: requestHeaders(refreshedCookieHeader, { "Content-Type": "application/x-www-form-urlencoded" }),
      body: confirmForm,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const confirm = await readEnvelope<never>(confirmResponse);
    if (confirm.code !== 0) {
      throw new BilibiliUpstreamError(
        confirm.message || `Bilibili Cookie refresh confirmation failed (${confirm.code})`,
      );
    }

    workingCookies = mergeBilibiliCookies(
      workingCookies.values(),
      responseCookies(confirmResponse, confirmUrl, this.now()),
      this.now(),
    );

    return {
      cookies: workingCookies,
      refreshToken: refresh.data.refresh_token,
      refreshed: true,
    };
  }

  async logout(session: WebSessionRecord): Promise<boolean> {
    const target = new URL("/login/exit/v2", PASSPORT_ORIGIN);
    const cookie = formatBilibiliCookieHeader(session.cookies.values(), target, this.now());
    const csrf = findBilibiliCookie(session.cookies.values(), "bili_jct", target, this.now())?.value;
    if (!cookie || !csrf) return false;

    const response = await this.fetchImpl(target, {
      method: "POST",
      headers: requestHeaders(cookie, { "Content-Type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({ biliCSRF: csrf }),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const envelope = await readEnvelope<{ redirectUrl?: string }>(response);
    return envelope.code === 0;
  }
}
