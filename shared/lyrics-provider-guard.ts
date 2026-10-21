// 三个歌词渠道的请求保护：结果缓存、同请求合并、限流冷却、每分钟请求预算。
// 参考上游做法：KuGouMusicApi 对成功响应缓存 2 分钟，LDDC 对搜索 / 取词结果缓存 4 小时。
// 不照搬 LDDC 的超时自动重试：限流窗口里超时往往就是惩罚本身，再打只会延长（AGENTS.md「网络请求」）。
// 冷却期间直接返回本地错误、不碰上游，到点后也不自动探测，等用户自己再点。

import type { LyricsProvider } from "./lyrics-format.js";

import {
  getProviderLyrics,
  LYRICS_PROVIDERS,
  PROVIDER_NAMES,
  searchProviderLyrics,
  type ProviderLyricsCandidate,
  type ProviderLyricsDocument,
  type ProviderLyricsError,
  type ProviderLyricsGetParams,
  type ProviderLyricsSearchParams,
  type ProviderResult,
  type ProviderTransport,
} from "./lyrics-providers.js";

// 搜索结果随曲库更新会变，半小时足够覆盖「搜一下、挨个预览」这一轮；歌词文件本身基本不变，留一天
const SEARCH_TTL_MS = 30 * 60_000;
const LYRICS_TTL_MS = 24 * 60 * 60_000;
// 「没有这份歌词」也记一会儿，免得用户反复点同一行
const NOT_FOUND_TTL_MS = 10 * 60_000;
// 上游没给 Retry-After 时的冷却：限流 1 分钟，服务异常 30 秒；上游给得再长也最多 10 分钟，避免误配把渠道锁死一天
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const UPSTREAM_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 10 * 60_000;
// 单个渠道每分钟最多发给上游的请求数。Web BFF 上所有用户共用服务器出口 IP，这道闸保护的是大家；
// 单人正常使用（搜一次 + 预览几首）远到不了
const REQUESTS_PER_MINUTE = 30;
const MAX_CACHE_ENTRIES = 200;

interface CacheEntry {
  expiresAt: number;
  value: ProviderResult<unknown>;
}

export interface ProviderClientOptions {
  now?: () => number;
  requestsPerMinute?: number;
}

// transport 每次调用传入（BFF 上它带着这次浏览器请求的超时 / 取消信号），缓存、冷却、预算在所有调用间共用。
// 同请求合并时后来者等的是先到者的那次上游请求
export interface ProviderClient {
  search: (
    transport: ProviderTransport,
    params: ProviderLyricsSearchParams,
  ) => Promise<ProviderResult<ProviderLyricsCandidate[]>>;
  get: (
    transport: ProviderTransport,
    params: ProviderLyricsGetParams,
  ) => Promise<ProviderResult<ProviderLyricsDocument>>;
}

const isProvider = (value: unknown): value is LyricsProvider => LYRICS_PROVIDERS.includes(value as LyricsProvider);

export function createProviderClient(options: ProviderClientOptions = {}): ProviderClient {
  const now = options.now ?? Date.now;
  const budget = options.requestsPerMinute ?? REQUESTS_PER_MINUTE;
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<ProviderResult<unknown>>>();
  const cooldownUntil = new Map<LyricsProvider, { until: number; kind: "rate_limited" | "upstream" }>();
  const sent = new Map<LyricsProvider, number[]>();

  const blocked = (provider: LyricsProvider): ProviderLyricsError | undefined => {
    const name = PROVIDER_NAMES[provider];
    const cooldown = cooldownUntil.get(provider);
    if (cooldown && cooldown.until > now()) {
      const retryAfterMs = cooldown.until - now();
      return {
        kind: cooldown.kind,
        provider,
        retryAfterMs,
        message: cooldown.kind === "rate_limited" ? `${name}刚才提示请求过于频繁` : `${name}服务刚才出错`,
      };
    }
    const recent = (sent.get(provider) ?? []).filter(time => time > now() - 60_000);
    sent.set(provider, recent);
    if (recent.length >= budget) {
      return {
        kind: "rate_limited",
        provider,
        retryAfterMs: recent[0] + 60_000 - now(),
        message: `${name}这一分钟请求太多了`,
      };
    }
    return undefined;
  };

  // 每次真正发给上游前过一遍闸：酷狗取词是两次串行请求，第二次也要算
  const guarded =
    (provider: LyricsProvider, transport: ProviderTransport): ProviderTransport =>
    async request => {
      const error = blocked(provider);
      if (error) throw new BlockedError(error);
      sent.get(provider)!.push(now());
      return transport(request);
    };

  const remember = (provider: LyricsProvider, result: ProviderResult<unknown>) => {
    if (result.ok) return;
    const { kind, retryAfterMs } = result.error;
    if (kind !== "rate_limited" && kind !== "upstream") return;
    const fallback = kind === "rate_limited" ? RATE_LIMIT_COOLDOWN_MS : UPSTREAM_COOLDOWN_MS;
    const duration = Math.min(MAX_COOLDOWN_MS, Math.max(retryAfterMs ?? fallback, fallback));
    cooldownUntil.set(provider, { until: now() + duration, kind });
    result.error.retryAfterMs = duration;
  };

  const ttlOf = (result: ProviderResult<unknown>, okTtl: number) => {
    if (result.ok) return okTtl;
    return result.error.kind === "not_found" ? NOT_FOUND_TTL_MS : 0;
  };

  async function run<T>(
    transport: ProviderTransport,
    provider: unknown,
    key: string,
    okTtl: number,
    task: (transport: ProviderTransport) => Promise<ProviderResult<T>>,
  ): Promise<ProviderResult<T>> {
    if (!isProvider(provider)) return task(transport);
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) {
      // 刷新 Map 顺序，淘汰时先丢最久没用的
      cache.delete(key);
      cache.set(key, hit);
      return structuredClone(hit.value) as ProviderResult<T>;
    }
    if (hit) cache.delete(key);

    const pending = inflight.get(key);
    if (pending) return structuredClone(await pending) as ProviderResult<T>;

    const early = blocked(provider);
    if (early) return { ok: false, error: early };

    const promise = task(guarded(provider, transport))
      .catch((error: unknown): ProviderResult<T> => {
        if (error instanceof BlockedError) return { ok: false, error: error.detail };
        throw error;
      })
      .then(result => {
        remember(provider, result);
        const ttl = ttlOf(result, okTtl);
        if (ttl > 0) {
          cache.set(key, { expiresAt: now() + ttl, value: structuredClone(result) });
          while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        }
        return result;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return structuredClone(await promise) as ProviderResult<T>;
  }

  return {
    search: (transport, params) =>
      run(
        transport,
        params.provider,
        JSON.stringify(["search", params.provider, params.title?.trim(), params.artist?.trim() ?? ""]),
        SEARCH_TTL_MS,
        guardedTransport => searchProviderLyrics(guardedTransport, params),
      ),
    get: (transport, params) =>
      run(
        transport,
        params.provider,
        JSON.stringify(["get", params.provider, params.id, params.durationMs ?? 0]),
        LYRICS_TTL_MS,
        guardedTransport => getProviderLyrics(guardedTransport, params),
      ),
  };
}

class BlockedError extends Error {
  constructor(readonly detail: ProviderLyricsError) {
    super(detail.message);
  }
}
