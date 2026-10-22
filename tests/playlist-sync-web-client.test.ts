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
    expect(mocks.get).toHaveBeenNthCalledWith(1, "/session");
    expect(mocks.get).toHaveBeenNthCalledWith(2, "/sync/favorites", { headers: undefined });
  });

  it("binds ranking batches to the expected account and never retries them under another account", async () => {
    mocks.get.mockResolvedValueOnce({ code: 0, data: { mid: "42" } });
    const { pushRankingEvents, invalidateSyncToken } = await import("@/service/sync/client");
    mocks.post.mockResolvedValueOnce({ mid: "42", version: 1, records: {} });
    await pushRankingEvents("42", "device", []);
    expect(mocks.post).toHaveBeenCalledWith(
      "/play-ranking",
      { expectedMid: "42", deviceId: "device", events: [] },
      { headers: undefined },
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
});
