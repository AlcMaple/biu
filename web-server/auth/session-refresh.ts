import { BilibiliAuthClient, BilibiliUpstreamError, type RefreshResult } from "./bilibili-auth.js";
import { type ResolvedWebSessionRecord, type WebSessionRecord, WebSessionStore } from "./session-store.js";

export const WEB_SESSION_REFRESH_CHECK_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;

export interface WebSessionRefreshCoordinatorOptions {
  authClient?: Pick<BilibiliAuthClient, "refreshSession">;
  checkIntervalMs?: number;
  now?: () => number;
  sessionStore: WebSessionStore;
}

const unchangedResult = (session: WebSessionRecord): RefreshResult => ({
  cookies: new Map(session.cookies),
  refreshToken: session.refreshToken,
  refreshed: false,
});

/**
 * Cookie 状态检查按服务端 session 单飞，并在发请求前推进冷却时间。
 * 上游失败会原样抛给当前请求，但不会让紧随其后的 API 请求形成刷新风暴。
 */
export class WebSessionRefreshCoordinator {
  private readonly authClient: Pick<BilibiliAuthClient, "refreshSession">;
  private readonly checkIntervalMs: number;
  private readonly flights = new WeakMap<WebSessionRecord, Promise<RefreshResult>>();
  private readonly now: () => number;
  private readonly sessionStore: WebSessionStore;

  constructor(options: WebSessionRefreshCoordinatorOptions) {
    this.authClient = options.authClient ?? new BilibiliAuthClient();
    this.checkIntervalMs = options.checkIntervalMs ?? WEB_SESSION_REFRESH_CHECK_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.sessionStore = options.sessionStore;
  }

  refreshIfDue(resolved: ResolvedWebSessionRecord): Promise<RefreshResult> {
    return this.refresh(resolved, false);
  }

  refreshNow(resolved: ResolvedWebSessionRecord): Promise<RefreshResult> {
    return this.refresh(resolved, true);
  }

  private refresh(resolved: ResolvedWebSessionRecord, force: boolean): Promise<RefreshResult> {
    const { session, sessionId } = resolved;
    if (![...session.cookies.values()].some(cookie => cookie.name === "SESSDATA" && cookie.value)) {
      return Promise.resolve(unchangedResult(session));
    }

    const flight = this.flights.get(session);
    if (flight) return flight;

    const now = this.now();
    if (!force && session.lastRefreshCheckAt + this.checkIntervalMs > now) {
      return Promise.resolve(unchangedResult(session));
    }

    // 先推进时间再发起请求；即使上游失败，也至少冷却一个检查周期且不自动重试。
    session.lastRefreshCheckAt = now;
    const nextFlight = this.authClient
      .refreshSession(session)
      .then(result => {
        this.sessionStore.updateSessionById(sessionId, {
          cookies: result.cookies.values(),
          refreshToken: result.refreshToken,
        });
        return result;
      })
      .catch(error => {
        if (error instanceof BilibiliUpstreamError && error.status === 401) {
          this.sessionStore.destroySessionById(sessionId);
        }
        throw error;
      })
      .finally(() => {
        this.flights.delete(session);
      });
    this.flights.set(session, nextFlight);
    return nextFlight;
  }
}
