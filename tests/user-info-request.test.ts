import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/service/request", () => ({
  apiRequest: requestMocks,
}));

import { clearWbiKeyCache } from "@/service/request/wbi-key-cache";
import { getUserInfo } from "@/service/user-info";

const response = {
  code: -101,
  data: {
    wbi_img: {
      img_url: "https://i0.hdslb.com/bfs/wbi/image-key.png",
      sub_url: "https://i0.hdslb.com/bfs/wbi/sub-key.png",
    },
  },
  message: "账号未登录",
  ttl: 1,
};

describe("user info request coordination", () => {
  beforeEach(() => {
    requestMocks.get.mockReset();
    clearWbiKeyCache();
  });

  it("coalesces concurrent navigation requests and caches anonymous WBI keys", async () => {
    let resolveRequest: ((value: typeof response) => void) | undefined;
    requestMocks.get.mockReturnValue(
      new Promise(resolve => {
        resolveRequest = resolve;
      }),
    );

    const first = getUserInfo();
    const second = getUserInfo();

    expect(first).toBe(second);
    expect(requestMocks.get).toHaveBeenCalledOnce();

    resolveRequest?.(response);
    await first;

    const { getCachedWbiKeys } = await import("@/service/request/wbi-key-cache");
    expect(getCachedWbiKeys()).toEqual({ img_key: "image-key", sub_key: "sub-key" });
  });

  it("allows a new navigation request after the shared one settles", async () => {
    requestMocks.get.mockResolvedValue(response);

    await getUserInfo();
    await getUserInfo();

    expect(requestMocks.get).toHaveBeenCalledTimes(2);
  });
});
