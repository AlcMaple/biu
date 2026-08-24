import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Web authentication client storage boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("removes legacy refresh tokens and never persists new ones in Web localStorage", async () => {
    localStorage.setItem(
      "user-token",
      JSON.stringify({ state: { tokenData: { refresh_token: "legacy-secret" } }, version: 0 }),
    );

    const { useToken } = await import("@/store/token");
    await useToken.persist.rehydrate();

    expect(localStorage.getItem("user-token")).toBeNull();

    useToken.getState().updateToken({ tokenData: { refresh_token: "new-secret" } });
    await Promise.resolve();

    expect(localStorage.getItem("user-token")).toBeNull();
  });

  it("allows Web login only where a Secure own-site session Cookie can be stored", async () => {
    const { isWebAuthLocationSupported } = await import("@/service/web-auth");

    expect(isWebAuthLocationSupported({ hostname: "music.example", protocol: "https:" })).toBe(true);
    expect(isWebAuthLocationSupported({ hostname: "localhost", protocol: "http:" })).toBe(true);
    expect(isWebAuthLocationSupported({ hostname: "127.0.0.1", protocol: "http:" })).toBe(true);
    expect(isWebAuthLocationSupported({ hostname: "192.168.1.23", protocol: "http:" })).toBe(false);
  });

  it("uses bounded QR, SMS, and manual refresh request timeouts", async () => {
    const get = vi.fn().mockResolvedValue({ code: 0 });
    const post = vi.fn().mockResolvedValue({ code: 0 });
    vi.doMock("@/service/request", () => ({ axiosInstance: { get, post } }));

    const {
      createWebQrCode,
      createWebSmsCaptcha,
      loginWithWebSms,
      pollWebQrCode,
      refreshWebAuthSession,
      sendWebSmsCode,
    } = await import("@/service/web-auth");
    await createWebQrCode();
    await pollWebQrCode("login-id");
    await createWebSmsCaptcha();
    await sendWebSmsCode({
      challenge: "challenge",
      cid: "86",
      loginId: "login-id",
      seccode: "seccode",
      tel: "13800138000",
      token: "token",
      validate: "validate",
    });
    await loginWithWebSms({ code: "123456", loginId: "login-id" });
    await refreshWebAuthSession();

    expect(post).toHaveBeenNthCalledWith(1, "/__biu_auth/qrcode", undefined, { timeout: 15_000 });
    expect(post).toHaveBeenNthCalledWith(2, "/__biu_auth/qrcode/poll", { loginId: "login-id" }, { timeout: 15_000 });
    expect(post).toHaveBeenNthCalledWith(3, "/__biu_auth/sms/captcha", undefined, { timeout: 15_000 });
    expect(post).toHaveBeenNthCalledWith(
      4,
      "/__biu_auth/sms/send",
      expect.objectContaining({ loginId: "login-id", tel: "13800138000" }),
      { timeout: 15_000 },
    );
    expect(post).toHaveBeenNthCalledWith(
      5,
      "/__biu_auth/sms/login",
      { code: "123456", loginId: "login-id" },
      { timeout: 15_000 },
    );
    expect(post).toHaveBeenNthCalledWith(6, "/__biu_auth/session/refresh", undefined, { timeout: 45_000 });
  });
});
