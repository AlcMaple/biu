export type QrRateLimitAction = "create" | "poll";

export interface QrRateLimitRule {
  globalLimit: number;
  perIpLimit: number;
  windowMs: number;
}

export interface QrRateLimiterOptions {
  create?: Partial<QrRateLimitRule>;
  now?: () => number;
  poll?: Partial<QrRateLimitRule>;
}

export interface QrRateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

const DEFAULT_RULES: Record<QrRateLimitAction, QrRateLimitRule> = {
  create: { globalLimit: 300, perIpLimit: 10, windowMs: 10 * 60 * 1000 },
  poll: { globalLimit: 6_000, perIpLimit: 120, windowMs: 5 * 60 * 1000 },
};

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
 * 全局桶始终生效；只有调用方显式提供可信客户端地址时才启用每 IP 桶。
 * 这样默认反代部署不会把所有用户误判成同一个 peer，也不会盲信客户端转发头。
 */
export class QrRateLimiter {
  private readonly buckets: Record<QrRateLimitAction, RateLimitBuckets> = {
    create: { global: [], perIp: new Map() },
    poll: { global: [], perIp: new Map() },
  };
  private readonly now: () => number;
  private readonly rules: Record<QrRateLimitAction, QrRateLimitRule>;

  constructor(options: QrRateLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.rules = {
      create: { ...DEFAULT_RULES.create, ...options.create },
      poll: { ...DEFAULT_RULES.poll, ...options.poll },
    };
  }

  consume(action: QrRateLimitAction, ip?: string): QrRateLimitResult {
    const now = this.now();
    const rule = this.rules[action];
    const bucket = this.buckets[action];
    const cutoff = now - rule.windowMs;

    prune(bucket.global, cutoff);
    for (const [key, timestamps] of bucket.perIp) {
      prune(timestamps, cutoff);
      if (timestamps.length === 0) bucket.perIp.delete(key);
    }

    const ipTimestamps = ip ? (bucket.perIp.get(ip) ?? []) : undefined;
    const limitingTimestamps =
      bucket.global.length >= rule.globalLimit
        ? bucket.global
        : ipTimestamps && ipTimestamps.length >= rule.perIpLimit
          ? ipTimestamps
          : undefined;

    if (limitingTimestamps) {
      const retryAt = limitingTimestamps[0] + rule.windowMs;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
    }

    bucket.global.push(now);
    if (ip && ipTimestamps) {
      ipTimestamps.push(now);
      bucket.perIp.set(ip, ipTimestamps);
    }
    return { allowed: true };
  }
}
