import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getCookie: vi.fn(),
  log: { warn: vi.fn() },
  post: vi.fn(),
}));

vi.mock("@/platform/detect", () => ({ isWeb: false }));
vi.mock("@/platform", () => ({ default: { getCookie: mocks.getCookie }, log: mocks.log }));
vi.mock("@/service/sync/http", () => ({ syncHttp: { get: mocks.get, post: mocks.post } }));

function httpError(status: number, retryAfter?: string) {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: { status, headers: retryAfter ? { "retry-after": retryAfter } : {} },
  });
}

describe("同步凭证换取失败后停手", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    mocks.get.mockReset();
    mocks.getCookie.mockReset().mockResolvedValue("sess");
    mocks.post.mockReset();
  });

  it("服务器回 503 + Retry-After 后，冷却期内重连和回到前台都不再去换凭证", async () => {
    vi.useFakeTimers();
    mocks.post.mockRejectedValueOnce(httpError(503, "240"));
    const { getCurrentMid, syncBlockedForMs, watchVersions } = await import("@/service/sync/client");

    await expect(watchVersions({})).resolves.toBeNull();
    expect(syncBlockedForMs()).toBe(240_000);

    await watchVersions({});
    await getCurrentMid();
    vi.advanceTimersByTime(239_000);
    await watchVersions({});
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.get).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);
    mocks.post.mockResolvedValueOnce({ token: "t", mid: "42" });
    await getCurrentMid();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("登录态失效（401）也停手，不每轮都让服务器替它去问 B 站", async () => {
    mocks.post.mockRejectedValueOnce(httpError(401));
    const { getCurrentMid, syncBlockedForMs } = await import("@/service/sync/client");

    await getCurrentMid();
    await getCurrentMid();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(syncBlockedForMs()).toBeGreaterThan(9 * 60_000);
  });

  it("换账号时清掉上一个账号的冷却", async () => {
    mocks.post.mockRejectedValueOnce(httpError(503, "300")).mockResolvedValueOnce({ token: "t", mid: "7" });
    const { getCurrentMid, invalidateSyncToken } = await import("@/service/sync/client");

    await getCurrentMid();
    invalidateSyncToken();
    await getCurrentMid();
    expect(mocks.post).toHaveBeenCalledTimes(1);

    invalidateSyncToken({ clearBlock: true });
    await expect(getCurrentMid()).resolves.toBe("7");
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
});
