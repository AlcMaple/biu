import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), mid: 1 }));
vi.mock("@/service/request", () => ({ apiRequest: { get: mocks.get } }));
vi.mock("@/store/user", () => ({ useUser: { getState: () => ({ user: { mid: mocks.mid } }) } }));
const payload = { code: 0, data: { pages: [{ cid: 11, page: 1, part: "第一集" }] } };
beforeEach(() => {
  vi.resetModules();
  mocks.get.mockReset();
  mocks.mid = 1;
});

describe("收藏分集元数据复用", () => {
  test("播放已取得的分集直接命中，不再请求 view", async () => {
    const service = await import("@/service/web-interface-view");
    mocks.get.mockResolvedValue(payload);
    await service.getWebInterfaceView({ bvid: "BV1" });
    expect(service.getCachedVideoPages("BV1")).toEqual(payload.data.pages);
    expect(await service.getVideoPages("BV1")).toEqual(payload.data.pages);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  test("播放请求未完成时收藏加入同一请求，冷收藏并发也只请求一次", async () => {
    const service = await import("@/service/web-interface-view");
    let resolve!: (value: typeof payload) => void;
    mocks.get.mockReturnValue(
      new Promise(done => {
        resolve = done;
      }),
    );
    const playback = service.getWebInterfaceView({ bvid: "BV1" });
    const first = service.getVideoPages("BV1");
    const second = service.getVideoPages("BV1");
    expect(mocks.get).toHaveBeenCalledTimes(1);
    resolve(payload);
    await expect(first).resolves.toEqual(payload.data.pages);
    await second;
    await playback;
  });
  test("业务错误不缓存、不自动重试，用户下一次操作可重新获取", async () => {
    const service = await import("@/service/web-interface-view");
    mocks.get.mockResolvedValueOnce({ code: -412 }).mockResolvedValueOnce(payload);
    await expect(service.getVideoPages("BV1")).rejects.toThrow("分集信息加载失败");
    expect(service.getCachedVideoPages("BV1")).toBeUndefined();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    await expect(service.getVideoPages("BV1")).resolves.toEqual(payload.data.pages);
  });
  test("网络拒绝释放进行中记录，空或损坏 pages 不缓存", async () => {
    const service = await import("@/service/web-interface-view");
    mocks.get.mockRejectedValueOnce(new Error("timeout"));
    await expect(service.getVideoPages("BV1")).rejects.toThrow("timeout");
    mocks.get.mockResolvedValue({ code: 0, data: { pages: [{ cid: 0, page: 1 }] } });
    await expect(service.getVideoPages("BV1")).rejects.toThrow();
    expect(service.getCachedVideoPages("BV1")).toBeUndefined();
  });
  test("五分钟过期、视频和账号隔离", async () => {
    const service = await import("@/service/web-interface-view");
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    mocks.get.mockResolvedValue(payload);
    await service.getVideoPages("BV1");
    expect(service.getCachedVideoPages("BV2")).toBeUndefined();
    mocks.mid = 2;
    expect(service.getCachedVideoPages("BV1")).toBeUndefined();
    mocks.mid = 1;
    now.mockReturnValue(300_000);
    expect(service.getCachedVideoPages("BV1")).toBeUndefined();
    await service.getVideoPages("BV1");
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  test("最多保留一百份分集，不缓存完整响应", async () => {
    const service = await import("@/service/web-interface-view");
    mocks.get.mockResolvedValue({ ...payload, data: { ...payload.data, user: { secret: "not-cached" } } });
    for (let i = 0; i < 101; i++) await service.getVideoPages(`BV${i}`);
    expect(service.getCachedVideoPages("BV0")).toBeUndefined();
    expect(JSON.stringify(service.getCachedVideoPages("BV100"))).not.toContain("secret");
  });
});
