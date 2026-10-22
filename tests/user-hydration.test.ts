import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
});

afterEach(() => window.localStorage.clear());

it.each([true, false])("平台层先加载时，真实用户 store 的首次 hydration 也能完成（已有缓存：%s）", async cached => {
  if (cached)
    window.localStorage.setItem("biu:user-login-info", JSON.stringify({ mid: 42, isLogin: true, uname: "fixture" }));
  await import("@/platform");
  const { useUser } = await import("@/store/user");
  await vi.waitFor(() => expect(useUser.persist.hasHydrated()).toBe(true), { timeout: 1500 });
});
