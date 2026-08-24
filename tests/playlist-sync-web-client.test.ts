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
});
