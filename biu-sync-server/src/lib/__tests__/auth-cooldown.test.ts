import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("axios", () => ({ default: { get } }));
vi.mock("../config.js", () => ({
  config: { bilibiliNavUrl: "https://nav.test", jwtSecret: "auth-cooldown-tests-only", jwtTtlSeconds: 7200 },
}));

const { BilibiliUnavailableError, InvalidCookieError, resetNavCooldownForTests, resolveMidFromCookie } =
  await import("../auth.js");

const ok = { data: { code: 0, data: { isLogin: true, mid: 42 } } };

describe("B 站验证失败后全局停手", () => {
  beforeEach(() => {
    get.mockReset();
    resetNavCooldownForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("被 B 站风控（HTTP 412）后 5 分钟内，任何用户的验证都不再请求 B 站", async () => {
    get.mockRejectedValueOnce(Object.assign(new Error("412"), { response: { status: 412 } }));

    await expect(resolveMidFromCookie("SESSDATA=a")).rejects.toMatchObject({ retryAfterSeconds: 300 });
    const second = resolveMidFromCookie("SESSDATA=b");
    await expect(second).rejects.toBeInstanceOf(BilibiliUnavailableError);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("接口返回风控码 -352 也算风控", async () => {
    get.mockResolvedValueOnce({ data: { code: -352 } });

    await expect(resolveMidFromCookie("SESSDATA=a")).rejects.toMatchObject({ retryAfterSeconds: 300 });
    await expect(resolveMidFromCookie("SESSDATA=a")).rejects.toBeInstanceOf(BilibiliUnavailableError);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("B 站超时或 5xx 停 1 分钟", async () => {
    get.mockRejectedValueOnce(new Error("timeout"));

    await expect(resolveMidFromCookie("SESSDATA=a")).rejects.toMatchObject({ retryAfterSeconds: 60 });
  });

  it("单个用户 cookie 失效不触发全局停手", async () => {
    get.mockResolvedValueOnce({ data: { code: -101, data: { isLogin: false } } }).mockResolvedValueOnce(ok);

    await expect(resolveMidFromCookie("SESSDATA=old")).rejects.toBeInstanceOf(InvalidCookieError);
    await expect(resolveMidFromCookie("SESSDATA=new")).resolves.toBe("42");
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("换凭证接口在冷却期回 503 并告诉客户端等多久", () => {
  it("返回 503 + Retry-After", async () => {
    const express = (await import("express")).default;
    const { createAuthRouter } = await import("../../routes/auth.js");
    resetNavCooldownForTests();
    get.mockReset().mockRejectedValueOnce(Object.assign(new Error("429"), { response: { status: 429 } }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const app = express();
    app.use(express.json());
    app.use("/api", createAuthRouter());
    const server = app.listen(0);
    const { port } = server.address() as { port: number };
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/exchange`, {
        body: JSON.stringify({ cookie: "SESSDATA=a" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("300");
    } finally {
      server.close();
    }
  });
});
