import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getCookie: vi.fn(),
  log: { warn: vi.fn() },
  post: vi.fn(),
}));

vi.mock("@/platform/detect", () => ({ isWeb: true }));
vi.mock("@/platform", () => ({ default: { getCookie: mocks.getCookie }, log: mocks.log }));
vi.mock("@/service/sync/http", () => ({ syncHttp: { get: mocks.get, post: mocks.post } }));

describe("Web playlist sync client", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.get.mockReset();
    mocks.getCookie.mockReset();
    mocks.log.warn.mockReset();
    mocks.post.mockReset();
  });

  it("uses the same-origin BFF session instead of reading or sending a Bilibili cookie", async () => {
    mocks.get
      .mockResolvedValueOnce({ code: 0, data: { mid: "42" } })
      .mockResolvedValueOnce({ data: {}, updatedAt: 1, version: 1 });

    const { getCurrentMid, pullSnapshot } = await import("@/service/sync/client");

    await expect(getCurrentMid()).resolves.toBe("42");
    await expect(pullSnapshot("favorites")).resolves.toMatchObject({ version: 1 });
    expect(mocks.getCookie).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenNthCalledWith(1, "/session", { signal: expect.any(AbortSignal) });
    expect(mocks.get).toHaveBeenNthCalledWith(2, "/sync/favorites", {
      headers: { "X-Biu-Expected-Mid": "42" },
      signal: expect.any(AbortSignal),
    });
  });

  it("binds ranking batches to the expected account and never retries them under another account", async () => {
    mocks.get.mockResolvedValueOnce({ code: 0, data: { mid: "42" } });
    const { pushRankingEvents, invalidateSyncToken } = await import("@/service/sync/client");
    mocks.post.mockResolvedValueOnce({ mid: "42", version: 1, records: {} });
    await pushRankingEvents("42", "device", []);
    expect(mocks.post).toHaveBeenCalledWith(
      "/play-ranking",
      { expectedMid: "42", deviceId: "device", events: [] },
      { headers: { "X-Biu-Expected-Mid": "42" }, signal: expect.any(AbortSignal) },
    );
    invalidateSyncToken();
    mocks.get.mockResolvedValueOnce({ code: 0, data: { mid: "99" } });
    await expect(pushRankingEvents("42", "device", [])).rejects.toThrow("账号已变化");
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a token exchange completed after an account switch", async () => {
    let resolve!: (value: unknown) => void;
    mocks.get.mockReturnValueOnce(
      new Promise(done => {
        resolve = done;
      }),
    );
    const { getCurrentMid, invalidateSyncToken } = await import("@/service/sync/client");
    const old = getCurrentMid();
    invalidateSyncToken();
    mocks.get.mockResolvedValueOnce({ code: 0, data: { mid: "99" } });
    expect(await getCurrentMid()).toBe("99");
    resolve({ code: 0, data: { mid: "42" } });
    expect(await old).toBeNull();
    expect(await getCurrentMid()).toBe("99");
  });
  it("401后身份变化不把旧推送重放给新账号", async () => {
    mocks.get
      .mockResolvedValueOnce({ code: 0, data: { mid: "42" } })
      .mockResolvedValueOnce({ code: 0, data: { mid: "99" } });
    mocks.post.mockRejectedValueOnce({ response: { status: 401 } });
    const { pushOps } = await import("@/service/sync/client");
    expect(await pushOps("favorites", 0, [], false, "42")).toBeNull();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
  it("同身份401只重放一次且保留期望账号标记", async () => {
    mocks.get.mockResolvedValue({ code: 0, data: { mid: "42" } });
    mocks.post.mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValueOnce({ version: 2 });
    const { pushOps } = await import("@/service/sync/client");
    expect(await pushOps("favorites", 0, [], false, "42")).toMatchObject({ version: 2 });
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[1][2]).toEqual({
      headers: { "X-Biu-Expected-Mid": "42" },
      signal: expect.any(AbortSignal),
    });
  });
  it("换身份后的迟到响应不返回给调用者", async () => {
    let resolve!: (value: unknown) => void;
    mocks.get.mockResolvedValueOnce({ code: 0, data: { mid: "42" } }).mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    const { getCurrentMid, pullSnapshot, invalidateSyncToken } = await import("@/service/sync/client");
    await getCurrentMid();
    const pending = pullSnapshot("favorites", "42");
    await Promise.resolve();
    await Promise.resolve();
    invalidateSyncToken();
    resolve({ version: 9, data: { old: true } });
    expect(await pending).toBeNull();
  });
  it("捕获的账号与新会话不一致时不发出推送", async () => {
    mocks.get.mockResolvedValueOnce({ code: 0, data: { mid: "99" } });
    const { pushOps } = await import("@/service/sync/client");
    expect(await pushOps("favorites", 0, [], false, "42")).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("身份失效实际取消旧HTTP请求，不等旧账号超时才让新会话继续", async () => {
    mocks.get.mockResolvedValueOnce({ code: 0, data: { mid: "42" } }).mockImplementationOnce(
      (_url: string, config: { signal: AbortSignal }) =>
        new Promise((_done, reject) => {
          config.signal?.addEventListener("abort", () => reject(new Error("fixture cancelled")));
        }),
    );
    const { getCurrentMid, pullSnapshot, invalidateSyncToken } = await import("@/service/sync/client");
    await getCurrentMid();
    const pending = pullSnapshot("favorites", "42");
    await Promise.resolve();
    await Promise.resolve();
    const signal = mocks.get.mock.calls[1][1]?.signal as AbortSignal | undefined;
    expect(signal).toBeDefined();
    invalidateSyncToken();
    expect(signal!.aborted).toBe(true);
    expect(await pending).toBeNull();
  });
  it("同步异常只传播固定文案与状态，不把HTTP凭据配置交给日志", async () => {
    mocks.get.mockResolvedValueOnce({ code: 0, data: { mid: "42" } });
    mocks.post.mockRejectedValueOnce({
      response: { status: 503 },
      config: { headers: { Authorization: "fixture-only" }, data: "fixture-private-body" },
    });
    const { pushOps } = await import("@/service/sync/client");
    const error = await pushOps("favorites", 0, [], false, "42").catch(error => error);
    expect(error).toMatchObject({
      status: 503,
      response: { status: 503 },
      message: expect.stringContaining("同步服务暂不可用"),
    });
    expect(error).not.toHaveProperty("config");
    expect(JSON.stringify(error)).not.toContain("fixture-only");
    expect(JSON.stringify(error)).not.toContain("fixture-private-body");
  });
  it("保留公开的业务错误提示而非把权限错误变成断网", async () => {
    mocks.get.mockResolvedValueOnce({ code: 0, data: { mid: "42" } });
    mocks.post.mockRejectedValueOnce({
      response: { status: 403, data: { error: "这是私密收藏夹" } },
      config: { headers: { Authorization: "fixture-only" } },
    });
    const { pushOps } = await import("@/service/sync/client");
    const error = await pushOps("favorites", 0, [], false, "42").catch(error => error);
    expect(error).toMatchObject({ response: { data: { error: "这是私密收藏夹" } } });
    expect(error).not.toHaveProperty("config");
  });
  it("旧账号通知通道不改用新账号建立请求", async () => {
    mocks.get.mockResolvedValueOnce({ code: 0, data: { mid: "99" } });
    const { watchVersions, getKnownSyncMid } = await import("@/service/sync/client");
    expect(await watchVersions({}, "42")).toBeNull();
    expect(getKnownSyncMid()).toBe("99");
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
